import { useCallback, useEffect, useState } from 'react';

import { COVER_LETTER_STATUS_CHECK_FAILED } from '../api/coverLetter';
import { ApiError } from '../api/client';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { CoverLetterSection } from '../components/CoverLetterSection';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

export function CartaPage() {
  const { api, isAuthenticated, blocksApp, expireSession } = useAuth();
  const canUseProduct = isAuthenticated && !blocksApp;
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [checking, setChecking] = useState(canUseProduct);
  const [statusError, setStatusError] = useState(false);

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!canUseProduct) {
        return;
      }
      setChecking(true);
      setStatusError(false);
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
        setStatus(null);
        setStatusError(true);
      } finally {
        if (!signal?.aborted) {
          setChecking(false);
        }
      }
    },
    [api, canUseProduct, expireSession],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  const embeddingsReady = status?.has_embeddings === true;
  const showCvGate = !checking && !statusError && status !== null && !embeddingsReady;

  return (
    <AppShell>
      <Card data-testid="carta-page">
        <CardHeader>
          <CardTitle>Carta de apresentação</CardTitle>
          <CardDescription>
            Informe só a empresa. A carta usa o seu currículo e não precisa de uma análise anterior.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {checking ? (
            <p
              data-testid="carta-loading"
              role="status"
              aria-live="polite"
              className="text-sm text-muted-foreground"
            >
              Verificando o currículo...
            </p>
          ) : null}

          {statusError ? (
            <div data-testid="carta-status-error" role="alert" aria-live="polite">
              <p className="text-sm">{COVER_LETTER_STATUS_CHECK_FAILED}</p>
              <Button
                type="button"
                data-testid="carta-status-retry"
                onClick={() => void loadStatus()}
                variant="outline"
                className="mt-3 w-full sm:w-auto"
              >
                Tentar de novo
              </Button>
            </div>
          ) : null}

          <CoverLetterSection
            variant="standalone"
            canGenerate={!checking && !statusError && embeddingsReady}
            showCvGate={showCvGate}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
