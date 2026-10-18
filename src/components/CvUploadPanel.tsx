import { useState, type ChangeEvent, type FormEvent } from 'react';

import {
  CV_NOT_READY,
  cvFailureMessage,
  formatCvUpdatedAt,
  type CvOperation,
} from '../api/cv';
import { ApiError } from '../api/client';
import type { UploadCvResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

type CvPhase = 'idle' | 'processando' | 'sucesso' | 'erro';

export type CvSessionFile = {
  filename?: string;
  updatedAt?: string;
};

type CvUploadPanelProps = {
  enabled: boolean;
  onStatusRefresh: () => Promise<void>;
  onReady?: (file: CvSessionFile) => void;
};

export function CvUploadPanel({
  enabled,
  onStatusRefresh,
  onReady,
}: CvUploadPanelProps) {
  const { api } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<CvPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryMode, setRetryMode] = useState<'upload' | 'rebuild' | null>(null);
  const [held, setHeld] = useState<CvSessionFile | null>(null);

  const busy = phase === 'processando';

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setError(null);
    if (phase === 'erro') {
      setPhase('idle');
      setRetryMode(null);
    }
  }

  function sessionFrom(result: UploadCvResponse): CvSessionFile {
    return {
      filename: result.filename,
      updatedAt: result.updated_at,
    };
  }

  async function finishReady(meta: CvSessionFile) {
    setHeld(meta);
    setPhase('sucesso');
    setRetryMode(null);
    setError(null);
    onReady?.(meta);
    try {
      await onStatusRefresh();
    } catch {
      // O 200 já concluiu o envio. Falha ao recarregar o status não vira erro de upload.
    }
  }

  function showFailure(operation: CvOperation, cause: unknown) {
    if (cause instanceof ApiError && cause.outdated) {
      return;
    }
    const status = cause instanceof ApiError ? cause.status : 0;
    setRetryMode(operation === 'rebuild' && status === 400 ? 'upload' : operation);
    setPhase('erro');
    setError(cvFailureMessage(operation, status));
  }

  async function runRebuild(meta: CvSessionFile | null) {
    setPhase('processando');
    setError(null);
    setRetryMode(null);
    try {
      await api.rebuildEmbeddings();
      await finishReady(meta ?? held ?? {});
    } catch (cause) {
      showFailure('rebuild', cause);
    }
  }

  async function runUpload(selected: File) {
    setPhase('processando');
    setError(null);
    setRetryMode(null);
    setHeld(null);
    try {
      const result = await api.uploadCv(selected);
      const meta = sessionFrom(result);
      if (result.ready_for_analysis === false || result.has_embeddings === false) {
        setHeld(meta);
        setRetryMode('rebuild');
        setPhase('erro');
        setError(CV_NOT_READY);
        return;
      }
      await finishReady(meta);
    } catch (cause) {
      showFailure('upload', cause);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!enabled || busy || !file) {
      return;
    }
    await runUpload(file);
  }

  async function handleRetry() {
    if (!enabled || busy) {
      return;
    }
    if (retryMode === 'rebuild') {
      await runRebuild(held);
      return;
    }
    if (file) {
      await runUpload(file);
      return;
    }
    setRetryMode('upload');
    setPhase('erro');
    setError('Selecione um currículo em PDF ou TXT para tentar de novo.');
  }

  return (
    <div data-testid="cv-panel" data-cv-state={phase} className="min-w-0">
      <form className="min-w-0" onSubmit={(event) => void handleSubmit(event)}>
        <Label className="block" htmlFor="cv-file">
          Arquivo do currículo (PDF ou TXT)
        </Label>
        <div className="mt-1.5 min-w-0 max-w-full overflow-hidden">
          <Input
            id="cv-file"
            data-testid="cv-file"
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            disabled={!enabled || busy}
            onChange={handleFileChange}
            className="h-auto max-w-full overflow-hidden py-2"
          />
        </div>
        <p
          data-testid="cv-filename"
          title={file?.name}
          className="mt-2 min-w-0 break-all text-sm text-muted-foreground"
        >
          {file ? file.name : 'Nenhum arquivo selecionado ainda.'}
        </p>
        <Button
          type="submit"
          data-testid="cv-submit"
          disabled={!enabled || busy || !file}
          aria-busy={busy}
          className="mt-4 w-full"
          size="lg"
        >
          {busy ? 'Processando' : 'Enviar arquivo'}
        </Button>
      </form>

      {phase === 'processando' ? (
        <p
          data-testid="cv-processing"
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-muted-foreground"
        >
          Processando
        </p>
      ) : null}

      {phase === 'sucesso' && (held?.filename || formatCvUpdatedAt(held?.updatedAt)) ? (
        <Alert data-testid="cv-success" role="status" variant="success" className="mt-4 min-w-0">
          <AlertDescription>
            {held?.filename ? (
              <p
                data-testid="cv-saved-filename"
                title={held.filename}
                className="min-w-0 break-all font-medium"
              >
                Currículo atualizado. Nome do arquivo: {held.filename}
              </p>
            ) : null}
            {formatCvUpdatedAt(held?.updatedAt) ? (
              <p data-testid="cv-saved-updated-at" className="mt-1 min-w-0 break-all">
                {formatCvUpdatedAt(held?.updatedAt)}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {phase === 'erro' && error ? (
        <Alert data-testid="cv-error" variant="destructive" className="mt-4">
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription className="mt-2">{error}</AlertDescription>
          <Button
            type="button"
            data-testid="cv-retry"
            onClick={() => void handleRetry()}
            disabled={!enabled || busy}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            Tentar de novo
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
