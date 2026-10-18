import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import { formatCvUpdatedAt } from '../api/cv';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { CvUploadPanel, type CvSessionFile } from '../components/CvUploadPanel';
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

export function CurriculoPage() {
  const { api, isAuthenticated, blocksApp, logout } = useAuth();
  const canUseProduct = isAuthenticated && !blocksApp;
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [loading, setLoading] = useState(canUseProduct);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [sessionFile, setSessionFile] = useState<CvSessionFile | null>(null);

  const hasCv = status?.has_cv === true;

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!canUseProduct) {
        return;
      }
      setLoading(true);
      setError(null);
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
          logout();
          return;
        }
        setError(STATUS_LOAD_ERROR);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [api, canUseProduct, logout],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  const showUpload = !hasCv || replacing;

  return (
    <AppShell>
      <Card data-testid="curriculo-page" className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Meu currículo</CardTitle>
          <CardDescription>PDF ou TXT.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 pt-2">
          {loading && !status ? (
            <div data-testid="curriculo-skeleton" role="status" aria-live="polite" className="grid gap-3">
              <span className="sr-only">Carregando currículo</span>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}

          {error ? (
            <div data-testid="curriculo-error" role="status">
              <p className="text-sm">{error}</p>
              <Button
                type="button"
                data-testid="curriculo-retry"
                onClick={() => void loadStatus()}
                variant="outline"
                size="sm"
                className="mt-3"
              >
                Tentar de novo
              </Button>
            </div>
          ) : null}

          {!error && hasCv && !replacing ? (
            <div className="grid min-w-0 gap-3">
              <p data-testid="cv-sent" className="text-sm font-medium">
                Currículo enviado
              </p>
              {sessionFile?.filename ? (
                <p
                  data-testid="cv-saved-filename"
                  title={sessionFile.filename}
                  className="min-w-0 break-all text-sm"
                >
                  Currículo atualizado. Nome do arquivo: {sessionFile.filename}
                </p>
              ) : null}
              {formatCvUpdatedAt(sessionFile?.updatedAt) ? (
                <p
                  data-testid="cv-saved-updated-at"
                  className="min-w-0 break-all text-sm text-muted-foreground"
                >
                  {formatCvUpdatedAt(sessionFile?.updatedAt)}
                </p>
              ) : null}
              <Button
                type="button"
                data-testid="cv-replace"
                onClick={() => setReplacing(true)}
                variant="outline"
              >
                Trocar arquivo
              </Button>
            </div>
          ) : null}

          {!error && status && showUpload ? (
            <CvUploadPanel
              enabled={canUseProduct}
              onStatusRefresh={loadStatus}
              onReady={(file) => {
                setSessionFile(file);
                setReplacing(false);
              }}
            />
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
