import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ProcessarPanel } from '../components/ProcessarPanel';
import { QuotaStatusCard } from '../components/QuotaStatusCard';

export function HomePage() {
  const { user, logout, api, isAuthenticated, blocksApp } = useAuth();
  const greeting = user?.display_name?.trim() || user?.email || 'usuario';
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const canUseProduct = isAuthenticated && !blocksApp;

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
    <div className="mx-auto min-h-dvh max-w-3xl px-5 py-5">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-extrabold text-ink">
          Meu Agente de Emprego
        </h1>
        <button
          type="button"
          data-testid="logout-button"
          onClick={logout}
          className="rounded-[18px] border-[3px] border-ink bg-paper px-4 py-2 font-display text-sm font-extrabold shadow-[4px_4px_0_#111]"
        >
          Sair
        </button>
      </header>

      <section
        data-testid="home-shell"
        className="mt-8 rounded-3xl border-[3px] border-ink bg-paper p-6 shadow-[8px_8px_0_#111]"
      >
        <p className="inline-block rounded-full border-[3px] border-ink bg-green px-3 py-1 text-xs font-bold">
          logado
        </p>
        <h2 className="mt-4 font-display text-[32px] font-extrabold text-ink">
          Ola, {greeting}
        </h2>
        <p className="mt-3 text-base leading-[1.45] text-ink">
          Voce esta logado. Consulte a cota do mes e envie uma vaga para
          analise. Billing Stripe, exportacao LGPD e upload de CV ficam para as
          proximas fatias.
        </p>
      </section>

      <QuotaStatusCard
        status={status}
        loading={statusLoading}
        error={statusError}
        onRetry={() => void loadStatus()}
      />

      <ProcessarPanel enabled={canUseProduct} onProcessed={loadStatus} />
    </div>
  );
}
