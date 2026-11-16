import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { formatCvUpdatedAt } from '../api/cv';
import {
  CV_FORM_OPEN_FAILED,
  CV_FORM_SAVED_LABEL,
  draftFromStructured,
  loadStructuredCvForEdit,
  type CvFormDraft,
} from '../api/structuredCv';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { CvFormSkeleton, CvFormWizard } from '../components/CvFormWizard';
import { CvUploadPanel, type CvSessionFile } from '../components/CvUploadPanel';
import { GenericError } from '../components/GenericError';
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

type CvEditor =
  | { phase: 'closed' }
  | { phase: 'loading' }
  | { phase: 'preparing' }
  | { phase: 'unavailable' }
  | { phase: 'failed' }
  | {
      phase: 'form';
      mode: 'create' | 'update';
      draft: CvFormDraft | null;
      email: string;
      replacedByFile: boolean;
    };

export function CurriculoPage() {
  const { api, user, isAuthenticated, blocksApp, expireSession } = useAuth();
  const canUseProduct = isAuthenticated && !blocksApp;
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [loading, setLoading] = useState(canUseProduct);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [sessionFile, setSessionFile] = useState<CvSessionFile | null>(null);
  const [editor, setEditor] = useState<CvEditor>({ phase: 'closed' });
  const [formSaved, setFormSaved] = useState(false);
  const editorRequest = useRef(0);

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
          expireSession();
          return;
        }
        setError(STATUS_LOAD_ERROR);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
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

  const showUpload = !hasCv || replacing;

  async function openEditor(forceCreate = false) {
    if (forceCreate) {
      setEditor({
        phase: 'form',
        mode: 'create',
        draft: null,
        email: user?.email ?? '',
        replacedByFile: false,
      });
      return;
    }
    const requestId = editorRequest.current + 1;
    editorRequest.current = requestId;
    setEditor({ phase: 'loading' });
    try {
      const result = await loadStructuredCvForEdit(() => api.getStructuredCv(), {
        onPending: () => {
          if (editorRequest.current === requestId) {
            setEditor({ phase: 'preparing' });
          }
        },
      });
      if (editorRequest.current !== requestId) {
        return;
      }
      if (result.kind === 'found') {
        setEditor({
          phase: 'form',
          mode: 'update',
          draft: draftFromStructured(result.cv),
          email: result.cv.email || user?.email || '',
          replacedByFile: result.cv.isCurrent === false,
        });
        return;
      }
      if (result.kind === 'missing') {
        setEditor({
          phase: 'form',
          mode: 'create',
          draft: null,
          email: user?.email ?? '',
          replacedByFile: false,
        });
        return;
      }
      setEditor({ phase: 'unavailable' });
    } catch (cause) {
      if (editorRequest.current !== requestId) {
        return;
      }
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        expireSession();
        return;
      }
      setEditor({ phase: 'failed' });
    }
  }

  function closeEditor() {
    editorRequest.current += 1;
    setEditor({ phase: 'closed' });
  }

  if (editor.phase === 'form') {
    return (
      <AppShell>
        <div data-testid="curriculo-page" className="min-w-0">
          <CvFormWizard
            mode={editor.mode}
            email={editor.email}
            initialDraft={editor.draft}
            replaceOnSave={hasCv || editor.mode === 'update'}
            replacedByFile={editor.replacedByFile}
            onCancel={closeEditor}
            onSaved={() => setFormSaved(true)}
            onStatusRefresh={loadStatus}
          />
        </div>
      </AppShell>
    );
  }

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
            <GenericError
              testId="curriculo-error"
              message={error}
              onRetry={() => void loadStatus()}
              retryTestId="curriculo-retry"
            />
          ) : null}

          {editor.phase === 'loading' || editor.phase === 'preparing' ? (
            <CvFormSkeleton preparing={editor.phase === 'preparing'} />
          ) : null}

          {editor.phase === 'unavailable' ? (
            <div className="grid gap-3" data-testid="cv-structured-unavailable">
              <p className="text-sm">{CV_FORM_OPEN_FAILED}</p>
              <Button type="button" data-testid="cv-structured-create" onClick={() => void openEditor(true)}>
                Criar pelo formulário
              </Button>
            </div>
          ) : null}

          {editor.phase === 'failed' ? (
            <GenericError
              testId="cv-structured-error"
              message={CV_FORM_OPEN_FAILED}
              onRetry={() => void openEditor()}
              retryTestId="cv-structured-retry"
            />
          ) : null}

          {!error && hasCv && !replacing && editor.phase === 'closed' ? (
            <div className="grid min-w-0 gap-3">
              <p data-testid="cv-sent" className="text-sm font-medium">
                Currículo enviado
              </p>
              {formSaved ? (
                <p data-testid="cv-form-saved-label" className="text-sm">
                  {CV_FORM_SAVED_LABEL}
                </p>
              ) : null}
              {sessionFile?.filename ? (
                <p data-testid="cv-saved-filename" className="min-w-0 text-sm">
                  Currículo atualizado. Nome do arquivo:{' '}
                  <span title={sessionFile.filename} className="min-w-0 break-words">
                    {sessionFile.filename}
                  </span>
                </p>
              ) : null}
              {formatCvUpdatedAt(sessionFile?.updatedAt) ? (
                <p
                  data-testid="cv-saved-updated-at"
                  className="min-w-0 text-sm text-muted-foreground"
                >
                  Atualizado em {formatCvUpdatedAt(sessionFile?.updatedAt)}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  data-testid="cv-replace"
                  onClick={() => setReplacing(true)}
                  variant="outline"
                  className="w-full"
                >
                  Trocar arquivo
                </Button>
                <Button
                  type="button"
                  data-testid="cv-edit-form"
                  onClick={() => void openEditor()}
                  variant="outline"
                  className="w-full"
                >
                  Editar pelo formulário
                </Button>
              </div>
            </div>
          ) : null}

          {!error && status && showUpload && editor.phase === 'closed' ? (
            <CvUploadPanel
              enabled={canUseProduct}
              onStatusRefresh={loadStatus}
              onReady={(file) => {
                setSessionFile(file);
                setReplacing(false);
              }}
            />
          ) : null}

          {!error && status && !hasCv && editor.phase === 'closed' ? (
            <Button
              type="button"
              data-testid="cv-edit-form"
              onClick={() => void openEditor()}
              variant="outline"
              className="mt-4 w-full"
            >
              Editar pelo formulário
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
