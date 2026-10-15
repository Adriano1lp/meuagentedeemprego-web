import { useState, type ChangeEvent, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import { canAnalyzeVaga } from '../api/status';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
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
import { Input } from './ui/input';
import { Label } from './ui/label';

type CvPhase = 'idle' | 'uploading' | 'rebuilding' | 'ready' | 'error';

type CvUploadPanelProps = {
  status: UserStatus | null;
  statusLoading: boolean;
  enabled: boolean;
  onStatusRefresh: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

export function CvUploadPanel({
  status,
  statusLoading,
  enabled,
  onStatusRefresh,
  onBusyChange,
}: CvUploadPanelProps) {
  const { api } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<CvPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<'upload' | 'embeddings' | null>(
    null,
  );
  const [uploadSucceeded, setUploadSucceeded] = useState(false);

  const ready = canAnalyzeVaga(status);
  const busy = phase === 'uploading' || phase === 'rebuilding';
  const showReady = ready && !busy && phase !== 'error';
  const uiState = showReady
    ? 'pronto'
    : phase === 'error'
      ? 'erro'
      : phase;
  const canRebuildOnly =
    enabled &&
    !busy &&
    !file &&
    (uploadSucceeded || status?.has_cv === true) &&
    status?.has_embeddings !== true;

  function setBusy(next: boolean) {
    onBusyChange?.(next);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setError(null);
    if (phase === 'error') {
      setPhase('idle');
      setFailedStep(null);
    }
  }

  async function runRebuild(): Promise<void> {
    setPhase('rebuilding');
    setFailedStep(null);
    setError(null);
    setBusy(true);
    try {
      await api.rebuildEmbeddings();
      await onStatusRefresh();
      setPhase('ready');
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      setFailedStep('embeddings');
      setPhase('error');
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Nao foi possivel processar os embeddings.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function runUploadAndRebuild(selected: File): Promise<void> {
    setError(null);
    setFailedStep(null);
    setUploadSucceeded(false);
    setPhase('uploading');
    setBusy(true);
    let uploaded = false;
    try {
      await api.uploadCv(selected);
      uploaded = true;
      setUploadSucceeded(true);
      setPhase('rebuilding');
      await api.rebuildEmbeddings();
      await onStatusRefresh();
      setPhase('ready');
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      setFailedStep(uploaded ? 'embeddings' : 'upload');
      setPhase('error');
      setError(
        cause instanceof ApiError
          ? cause.message
          : uploaded
            ? 'Nao foi possivel processar os embeddings.'
            : 'Nao foi possivel enviar o curriculo.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!enabled || busy) {
      return;
    }
    if (file) {
      await runUploadAndRebuild(file);
      return;
    }
    if (canRebuildOnly) {
      await runRebuild();
    }
  }

  async function handleRetry() {
    if (!enabled || busy) {
      return;
    }
    if (failedStep === 'embeddings') {
      await runRebuild();
      return;
    }
    if (file) {
      await runUploadAndRebuild(file);
      return;
    }
    setError('Selecione um curriculo em PDF ou TXT para tentar de novo.');
    setPhase('error');
    setFailedStep('upload');
  }

  const submitEnabled = enabled && !busy && (Boolean(file) || canRebuildOnly);
  const submitLabel = busy
    ? phase === 'uploading'
      ? 'Enviando curriculo...'
      : 'Reconstruindo embeddings...'
    : file
      ? 'Enviar curriculo'
      : canRebuildOnly
        ? 'Gerar embeddings'
        : 'Enviar curriculo';

  return (
    <Card
      data-testid="cv-panel"
      data-cv-state={uiState}
      aria-labelledby="cv-title"
      className="mt-6"
    >
      <CardHeader>
        <Badge variant="outline">POST /users/me/upload-cv</Badge>
        <CardTitle id="cv-title">Curriculo e embeddings</CardTitle>
        <CardDescription className="text-foreground">
          Envie um arquivo .pdf ou .txt. Ordem: POST /users/me/upload-cv, depois
          POST /users/me/rebuild-embeddings. Analisar vaga so libera se GET
          /users/me/status vier com has_embeddings true.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {statusLoading ? (
          <p
            data-testid="cv-status-loading"
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            Carregando status do curriculo...
          </p>
        ) : null}

        {!statusLoading && !ready && !busy && phase !== 'error' ? (
          <p
            data-testid="cv-missing"
            role="status"
            className="text-sm leading-relaxed"
          >
            {status?.has_cv === true
              ? 'Curriculo presente, mas embeddings ainda nao estao prontos. Gere os embeddings ou envie o arquivo de novo.'
              : 'Sem curriculo valido. Envie um PDF ou TXT para habilitar Analisar vaga.'}
          </p>
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-5">
          <Label className="block" htmlFor="cv-file">
            Arquivo do curriculo (PDF ou TXT)
          </Label>
          <Input
            id="cv-file"
            data-testid="cv-file"
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            disabled={!enabled || busy}
            onChange={handleFileChange}
            className="mt-1.5 h-auto py-2"
          />
          <p data-testid="cv-filename" className="mt-2 break-all text-sm text-muted-foreground">
            {file ? file.name : 'Nenhum arquivo selecionado ainda.'}
          </p>
          <Button
            type="submit"
            data-testid="cv-submit"
            disabled={!submitEnabled}
            aria-busy={busy}
            className="mt-4 w-full"
            size="lg"
          >
            {submitLabel}
          </Button>
        </form>

        {phase === 'uploading' ? (
          <p
            data-testid="cv-uploading"
            role="status"
            aria-live="polite"
            className="mt-4 text-sm text-muted-foreground"
          >
            Enviando curriculo para a API...
          </p>
        ) : null}

        {phase === 'rebuilding' ? (
          <p
            data-testid="cv-rebuilding"
            role="status"
            aria-live="polite"
            className="mt-4 text-sm text-muted-foreground"
          >
            Reconstruindo embeddings...
          </p>
        ) : null}

        {showReady ? (
          <Alert
            data-testid="cv-ready"
            role="status"
            aria-live="polite"
            variant="success"
            className="mt-4"
          >
            <AlertDescription>
              Pronto. Embeddings no status liberam Analisar vaga.
            </AlertDescription>
          </Alert>
        ) : null}

        {phase === 'error' && error ? (
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
      </CardContent>
    </Card>
  );
}
