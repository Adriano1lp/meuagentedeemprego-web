import { useCallback, useEffect, useState } from 'react';

import { isEssencialActive, type BillingMe } from '../api/billing';
import { ApiError } from '../api/client';
import { analyzeBlockReason, canAnalyzeVaga } from '../api/status';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { BillingConfirmation } from '../components/BillingConfirmation';
import { CvUploadPanel } from '../components/CvUploadPanel';
import { GenericError } from '../components/GenericError';
import { HomeShortcuts } from '../components/HomeShortcuts';
import { ProcessarPanel } from '../components/ProcessarPanel';
import { QUOTA_LOAD_ERROR, QuotaStatusCard } from '../components/QuotaStatusCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';

const STATUS_LOAD_ERROR = 'Não foi possível carregar agora.';

export function HomePage() {
  const { user, api, isAuthenticated, blocksApp, expireSession } = useAuth();
  const greeting = user?.display_name?.trim() || user?.email || 'usuário';
  const canUseProduct = isAuthenticated && !blocksApp;
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(canUseProduct);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [billingLoading, setBillingLoading] = useState(canUseProduct);
  const [billingError, setBillingError] = useState<string | null>(null);

  const hasCv = status?.has_cv === true;
  const canAnalyze = canUseProduct && canAnalyzeVaga(status);
  const processarGate = analyzeBlockReason(status);

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!canUseProduct) {
        return;
      }
      setStatusLoading(true);
      setStatusError(null);
      try {
        const next = await api.getStatus();
        if (signal?.aborted) {
          return;
        }
        setStatus(next);
      } catch (cause) {
        if (signal?.aborted) {
          return;
        }
        if (cause instanceof ApiError && cause.outdated) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          expireSession();
          return;
        }
        setStatusError(STATUS_LOAD_ERROR);
      } finally {
        if (!signal?.aborted) {
          setStatusLoading(false);
        }
      }
    },
    [api, canUseProduct, expireSession],
  );

  const loadBilling = useCallback(
    async (signal?: AbortSignal) => {
      if (!canUseProduct) {
        return;
      }
      setBillingLoading(true);
      setBillingError(null);
      try {
        const next = await api.getBillingMe(signal);
        if (signal?.aborted) {
          return;
        }
        setBilling(next);
      } catch (cause) {
        if (signal?.aborted) {
          return;
        }
        if (cause instanceof ApiError && cause.outdated) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          expireSession();
          return;
        }
        setBilling(null);
        setBillingError(QUOTA_LOAD_ERROR);
      } finally {
        if (!signal?.aborted) {
          setBillingLoading(false);
        }
      }
    },
    [api, canUseProduct, expireSession],
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadStatus(), loadBilling()]);
  }, [loadBilling, loadStatus]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    void loadBilling(controller.signal);
    return () => controller.abort();
  }, [loadBilling, loadStatus]);

  return (
    <AppShell>
      <Card data-testid="home-shell">
        <CardHeader className="pb-5 md:pb-6">
          <Badge variant="secondary">logado</Badge>
          <CardTitle>Olá, {greeting}</CardTitle>
          <CardDescription>
            Você está logado. Análise de vaga, carta, histórico e perfil a partir daqui.
          </CardDescription>
        </CardHeader>
      </Card>

      <BillingConfirmation enabled={canUseProduct} onConfirmed={refresh} />

      <HomeShortcuts />

      <QuotaStatusCard
        billing={billing}
        loading={billingLoading}
        error={billingError}
        onRetry={() => void loadBilling()}
      />

      {statusLoading && !status ? (
        <div data-testid="home-skeleton" role="status" aria-live="polite" className="mt-6 grid gap-3">
          <span className="sr-only">Carregando início</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {statusError ? (
        <Card data-testid="home-status-error" className="mt-6">
          <CardContent className="pt-5">
            <GenericError
              message={statusError}
              onRetry={() => void loadStatus()}
              retryTestId="home-status-retry"
            />
          </CardContent>
        </Card>
      ) : null}

      {!statusError && status && !hasCv ? (
        <Card data-testid="cv-onboarding" className="mt-6">
          <CardHeader>
            <CardTitle>Enviar arquivo</CardTitle>
            <CardDescription>
              Envie um PDF ou TXT. A análise fica bloqueada até o currículo estar pronto.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-2">
            <CvUploadPanel enabled={canUseProduct} onStatusRefresh={loadStatus} />
            <div>
              <Button type="button" data-testid="cv-create-form" disabled className="w-full">
                Criar pelo formulário
              </Button>
              <p data-testid="cv-create-form-soon" className="mt-2 text-sm text-muted-foreground">
                em breve
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!statusError && status ? (
        <ProcessarPanel
          enabled={canAnalyze}
          blockedMessage={canAnalyze ? null : processarGate}
          onProcessed={refresh}
          allowSubscriptionCta={!isEssencialActive({ plan: status?.plan })}
        />
      ) : null}
    </AppShell>
  );
}
