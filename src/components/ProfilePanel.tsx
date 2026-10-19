import { useCallback, useEffect, useState } from 'react';

import { isAbortError, isEssencialActive } from '../api/billing';
import { ApiError } from '../api/client';
import {
  hasProfileIdentity,
  PROFILE_LOAD_FAILED,
  safeProfileErrorMessage,
  subscriptionStatusLabel,
} from '../api/profile';
import { planLabel } from '../api/status';
import type { CurrentUser } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LgpdAccountActions } from './LgpdAccountActions';
import { PrivacyShortcut } from './PrivacyShortcut';
import { SubscribeEssencialButton } from './SubscribeEssencialButton';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';

type ProfileView =
  | { kind: 'loading' }
  | { kind: 'ready'; user: CurrentUser }
  | { kind: 'error'; message: string };

export function ProfilePanel() {
  const { api, isAuthenticated, blocksApp, logout, expireSession } = useAuth();
  const [view, setView] = useState<ProfileView>({ kind: 'loading' });
  const [showSubscribe, setShowSubscribe] = useState(false);
  const canLoad = isAuthenticated && !blocksApp;

  const loadProfile = useCallback(async () => {
    if (!canLoad) {
      return;
    }
    setView({ kind: 'loading' });
    try {
      const user = await api.getCurrentUser();
      setView({ kind: 'ready', user });
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      setView({
        kind: 'error',
        message: safeProfileErrorMessage(cause),
      });
    }
  }, [api, canLoad]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!canLoad) {
      setShowSubscribe(false);
      return;
    }
    const controller = new AbortController();
    api
      .getBillingMe(controller.signal)
      .then((billing) => {
        if (!controller.signal.aborted) {
          setShowSubscribe(!isEssencialActive(billing));
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || isAbortError(cause)) {
          return;
        }
        if (cause instanceof ApiError && cause.outdated) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          expireSession();
          return;
        }
        setShowSubscribe(false);
      });
    return () => controller.abort();
  }, [api, canLoad, expireSession]);

  const user = view.kind === 'ready' ? view.user : null;
  const plan = planLabel(user?.plan);
  const subscription = subscriptionStatusLabel(user?.subscription_status);

  return (
    <>
      <Card data-testid="profile-panel" aria-labelledby="profile-title">
        <CardHeader>
          <Badge variant="outline">Sua conta</Badge>
          <CardTitle id="profile-title">Perfil</CardTitle>
          <CardDescription className="text-foreground">
            Nome, e-mail e plano da sua conta. Sem edição de currículo nesta
            tela.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {view.kind === 'loading' ? (
            <p
              data-testid="profile-loading"
              role="status"
              aria-live="polite"
              className="text-sm text-muted-foreground"
            >
              Carregando perfil...
            </p>
          ) : null}

          {view.kind === 'error' ? (
            <Alert data-testid="profile-error" variant="destructive">
              <AlertTitle>Não foi possível carregar o perfil.</AlertTitle>
              <AlertDescription className="mt-2">
                {view.message || PROFILE_LOAD_FAILED}
              </AlertDescription>
              <Button
                type="button"
                data-testid="profile-retry"
                onClick={() => void loadProfile()}
                variant="outline"
                size="sm"
                className="mt-4"
              >
                Tentar novamente
              </Button>
            </Alert>
          ) : null}

          {user && !hasProfileIdentity(user) ? (
            <p
              data-testid="profile-empty"
              role="status"
              className="text-sm text-muted-foreground"
            >
              A conta não trouxe nome, e-mail ou plano.
            </p>
          ) : null}

          {user && hasProfileIdentity(user) ? (
            <dl data-testid="profile-values" className="grid gap-3 text-sm">
              {user.display_name ? (
                <div className="rounded-lg bg-muted px-3 py-2">
                  <dt className="text-xs font-medium text-muted-foreground">Nome</dt>
                  <dd data-testid="profile-name" className="mt-0.5 break-words font-medium">
                    {user.display_name}
                  </dd>
                </div>
              ) : null}
              {user.email ? (
                <div className="rounded-lg bg-muted px-3 py-2">
                  <dt className="text-xs font-medium text-muted-foreground">E-mail</dt>
                  <dd data-testid="profile-email" className="mt-0.5 break-all font-medium">
                    {user.email}
                  </dd>
                </div>
              ) : null}
              {plan ? (
                <div className="rounded-lg bg-muted px-3 py-2">
                  <dt className="text-xs font-medium text-muted-foreground">Plano</dt>
                  <dd data-testid="profile-plan" className="mt-0.5 font-medium">
                    {plan}
                  </dd>
                </div>
              ) : null}
              {subscription ? (
                <div className="rounded-lg bg-muted px-3 py-2">
                  <dt className="text-xs font-medium text-muted-foreground">Status</dt>
                  <dd data-testid="profile-status" className="mt-0.5 font-medium">
                    {subscription}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {showSubscribe ? <SubscribeEssencialButton /> : null}

          <Button
            type="button"
            data-testid="profile-logout"
            onClick={logout}
            variant="outline"
            className="mt-6 w-full sm:w-auto"
          >
            Sair
          </Button>
        </CardContent>
      </Card>

      <PrivacyShortcut />
      <LgpdAccountActions enabled={canLoad} />
    </>
  );
}
