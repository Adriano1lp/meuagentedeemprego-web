import { useCallback, useEffect, useState } from 'react';

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

type ProfileView =
  | { kind: 'loading' }
  | { kind: 'ready'; user: CurrentUser }
  | { kind: 'error'; message: string };

export function ProfilePanel() {
  const { api, isAuthenticated, blocksApp, logout } = useAuth();
  const [view, setView] = useState<ProfileView>({ kind: 'loading' });
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

  const user = view.kind === 'ready' ? view.user : null;
  const plan = planLabel(user?.plan);
  const subscription = subscriptionStatusLabel(user?.subscription_status);

  return (
    <>
      <section
        data-testid="profile-panel"
        aria-labelledby="profile-title"
        className="mt-8 rounded-3xl border-[3px] border-ink bg-pink p-6 shadow-[8px_8px_0_#111]"
      >
        <p className="inline-block rounded-full border-[3px] border-ink bg-paper px-3 py-1 text-xs font-bold">
          Sua conta
        </p>
        <h2
          id="profile-title"
          className="mt-4 font-display text-[28px] font-extrabold leading-none text-ink"
        >
          Perfil
        </h2>
        <p className="mt-3 text-sm leading-[1.45] text-ink">
          Nome, email e plano que a conta autenticada devolve. Sem edicao de
          curriculo nesta tela.
        </p>

        {view.kind === 'loading' ? (
          <p
            data-testid="profile-loading"
            role="status"
            aria-live="polite"
            className="mt-5 text-sm text-ink"
          >
            Carregando perfil...
          </p>
        ) : null}

        {view.kind === 'error' ? (
          <div
            data-testid="profile-error"
            role="alert"
            className="mt-5 rounded-[18px] border-[3px] border-ink bg-paper p-5"
          >
            <p className="font-display text-lg font-extrabold text-ink">
              Nao foi possivel carregar o perfil.
            </p>
            <p className="mt-2 text-sm leading-[1.45] text-ink">
              {view.message || PROFILE_LOAD_FAILED}
            </p>
            <button
              type="button"
              data-testid="profile-retry"
              onClick={() => void loadProfile()}
              className="mt-4 rounded-[18px] border-[3px] border-ink bg-yellow px-4 py-2 font-display text-sm font-extrabold"
            >
              Tentar novamente
            </button>
          </div>
        ) : null}

        {user && !hasProfileIdentity(user) ? (
          <p
            data-testid="profile-empty"
            role="status"
            className="mt-5 text-sm text-ink"
          >
            A conta nao trouxe nome, email ou plano.
          </p>
        ) : null}

        {user && hasProfileIdentity(user) ? (
          <dl
            data-testid="profile-values"
            className="mt-5 grid gap-3 text-sm text-ink"
          >
            {user.display_name ? (
              <div>
                <dt className="font-bold">Nome</dt>
                <dd data-testid="profile-name" className="break-words">
                  {user.display_name}
                </dd>
              </div>
            ) : null}
            {user.email ? (
              <div>
                <dt className="font-bold">Email</dt>
                <dd data-testid="profile-email" className="break-all">
                  {user.email}
                </dd>
              </div>
            ) : null}
            {plan ? (
              <div>
                <dt className="font-bold">Plano</dt>
                <dd data-testid="profile-plan">{plan}</dd>
              </div>
            ) : null}
            {subscription ? (
              <div>
                <dt className="font-bold">Status</dt>
                <dd data-testid="profile-status">{subscription}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <button
          type="button"
          data-testid="profile-logout"
          onClick={logout}
          className="mt-6 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] sm:w-auto"
        >
          Sair
        </button>
      </section>

      <PrivacyShortcut />
      <LgpdAccountActions enabled={canLoad} />
    </>
  );
}
