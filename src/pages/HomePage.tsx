import { useCallback, useEffect, useState } from 'react';

import { isEssencialActive } from '../api/billing';
import { ApiError } from '../api/client';
import { analyzeBlockReason, canAnalyzeVaga } from '../api/status';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { BillingConfirmation } from '../components/BillingConfirmation';
import { CvUploadPanel } from '../components/CvUploadPanel';
import { ProcessarPanel } from '../components/ProcessarPanel';
import { QuotaStatusCard } from '../components/QuotaStatusCard';
import { Badge } from '../components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

export function HomePage() {
  const { user, api, isAuthenticated, blocksApp } = useAuth();
  const greeting = user?.display_name?.trim() || user?.email || 'usuario';
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cvBusy, setCvBusy] = useState(false);

  const canUseProduct = isAuthenticated && !blocksApp;
  const canAnalyze = canUseProduct && canAnalyzeVaga(status) && !cvBusy;
  const processarGate = cvBusy
    ? 'Reconstruindo embeddings. Analisar vaga fica bloqueado ate has_embeddings no status.'
    : analyzeBlockReason(status);

  const loadStatus = useCallback(async () => {
    if (!canUseProduct) {
      return;
    }
    setStatusLoading(true);
    setStatusError(null);
    try {
      const next = await api.getStatus();
      setStatus(next);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      setStatus(null);
      setStatusError(
        cause instanceof ApiError
          ? cause.message
          : 'Nao foi possivel carregar o status.',
      );
    } finally {
      setStatusLoading(false);
    }
  }, [api, canUseProduct]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return (
    <AppShell>
      <Card data-testid="home-shell">
        <CardHeader className="pb-5 md:pb-6">
          <Badge variant="secondary">logado</Badge>
          <CardTitle>Ola, {greeting}</CardTitle>
          <CardDescription className="text-foreground">
            Voce esta logado. Envie o curriculo (.pdf ou .txt), aguarde os
            embeddings e so entao analise uma vaga.
          </CardDescription>
        </CardHeader>
      </Card>

      <BillingConfirmation enabled={canUseProduct} onConfirmed={loadStatus} />

      <QuotaStatusCard
        status={status}
        loading={statusLoading}
        error={statusError}
        onRetry={() => void loadStatus()}
      />

      <CvUploadPanel
        status={status}
        statusLoading={statusLoading}
        enabled={canUseProduct}
        onStatusRefresh={loadStatus}
        onBusyChange={setCvBusy}
      />

      <ProcessarPanel
        enabled={canAnalyze}
        blockedMessage={canAnalyze ? null : processarGate}
        onProcessed={loadStatus}
        allowSubscriptionCta={!isEssencialActive({ plan: status?.plan })}
      />
    </AppShell>
  );
}
