import { useState, type ChangeEvent, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import { canAnalyzeVaga } from '../api/status';
import type { UserStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';

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
    <section
      data-testid="cv-panel"
      data-cv-state={uiState}
      aria-labelledby="cv-title"
      className="mt-6 rounded-3xl border-[3px] border-ink bg-orange p-6 shadow-[8px_8px_0_#111]"
    >
      <p className="inline-block rounded-full border-[3px] border-ink bg-paper px-3 py-1 text-xs font-bold">
        POST /users/me/upload-cv
      </p>
      <h2
        id="cv-title"
        className="mt-4 font-display text-[28px] font-extrabold leading-none text-ink"
      >
        Curriculo e embeddings
      </h2>
      <p className="mt-3 text-sm leading-[1.45] text-ink">
        Envie um arquivo .pdf ou .txt. Ordem: POST /users/me/upload-cv, depois
        POST /users/me/rebuild-embeddings. Analisar vaga so libera se GET
        /users/me/status vier com has_embeddings true.
      </p>

      {statusLoading ? (
        <p
          data-testid="cv-status-loading"
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-ink"
        >
          Carregando status do curriculo...
        </p>
      ) : null}

      {!statusLoading && !ready && !busy && phase !== 'error' ? (
        <p
          data-testid="cv-missing"
          role="status"
          className="mt-4 text-sm leading-[1.45] text-ink"
        >
          {status?.has_cv === true
            ? 'Curriculo presente, mas embeddings ainda nao estao prontos. Gere os embeddings ou envie o arquivo de novo.'
            : 'Sem curriculo valido. Envie um PDF ou TXT para habilitar Analisar vaga.'}
        </p>
      ) : null}

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-5">
        <label className="block text-sm text-ink" htmlFor="cv-file">
          Arquivo do curriculo (PDF ou TXT)
        </label>
        <input
          id="cv-file"
          data-testid="cv-file"
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          disabled={!enabled || busy}
          onChange={handleFileChange}
          className="mt-1 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-sm text-ink file:mr-3 file:rounded-full file:border-[2px] file:border-ink file:bg-green file:px-3 file:py-1 file:font-display file:text-xs file:font-extrabold disabled:opacity-60"
        />
        <p data-testid="cv-filename" className="mt-2 text-sm text-ink">
          {file ? file.name : 'Nenhum arquivo selecionado ainda.'}
        </p>
        <button
          type="submit"
          data-testid="cv-submit"
          disabled={!submitEnabled}
          aria-busy={busy}
          className={`mt-4 w-full rounded-[18px] border-[3px] border-ink px-4 py-3 font-display text-[15px] font-extrabold ${
            submitEnabled
              ? 'bg-green text-ink'
              : 'cursor-not-allowed bg-paper text-muted'
          }`}
        >
          {submitLabel}
        </button>
      </form>

      {phase === 'uploading' ? (
        <p
          data-testid="cv-uploading"
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-ink"
        >
          Enviando curriculo para a API...
        </p>
      ) : null}

      {phase === 'rebuilding' ? (
        <p
          data-testid="cv-rebuilding"
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-ink"
        >
          Reconstruindo embeddings...
        </p>
      ) : null}

      {showReady ? (
        <p
          data-testid="cv-ready"
          role="status"
          aria-live="polite"
          className="mt-4 rounded-[18px] border-[3px] border-ink bg-green px-4 py-3 text-sm text-ink"
        >
          Pronto. Embeddings no status liberam Analisar vaga.
        </p>
      ) : null}

      {phase === 'error' && error ? (
        <div
          data-testid="cv-error"
          role="alert"
          className="mt-4 rounded-[18px] border-[3px] border-ink bg-paper p-4"
        >
          <p className="font-display text-lg font-extrabold text-ink">Erro</p>
          <p className="mt-2 text-sm leading-[1.45] text-ink">{error}</p>
          <button
            type="button"
            data-testid="cv-retry"
            onClick={() => void handleRetry()}
            disabled={!enabled || busy}
            className="mt-3 rounded-[18px] border-[3px] border-ink bg-green px-4 py-2 font-display text-sm font-extrabold disabled:opacity-60"
          >
            Tentar de novo
          </button>
        </div>
      ) : null}
    </section>
  );
}
