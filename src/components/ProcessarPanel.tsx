import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import {
  canOfferPdfDownload,
  fileNameFromPdfUrl,
  isPdfMagic,
  triggerBrowserDownload,
} from '../api/processar';
import type { ProcessarResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';

type ProcessarOutcome =
  | { kind: 'idle' }
  | { kind: 'success'; result: ProcessarResponse }
  | { kind: 'blocked'; result: ProcessarResponse }
  | { kind: 'quota'; message: string }
  | { kind: 'error'; message: string };

type ProcessarPanelProps = {
  enabled: boolean;
  onProcessed: () => Promise<void>;
};

export function ProcessarPanel({ enabled, onProcessed }: ProcessarPanelProps) {
  const { api } = useAuth();
  const [texto, setTexto] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadState, setDownloadState] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ProcessarOutcome>({ kind: 'idle' });

  const canSubmit = enabled && !submitting && texto.trim().length > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!enabled || submitting) {
      return;
    }
    const trimmed = texto.trim();
    if (!trimmed) {
      setOutcome({
        kind: 'error',
        message: 'Cole o texto da vaga para analisar.',
      });
      return;
    }

    setSubmitting(true);
    setDownloadState('idle');
    setDownloadError(null);
    setOutcome({ kind: 'idle' });
    try {
      const result = await api.processar(trimmed);
      setOutcome(
        result.generation_blocked === true
          ? { kind: 'blocked', result }
          : { kind: 'success', result },
      );
      try {
        await onProcessed();
      } catch {
        // A analise ja veio do servidor; falha ao refrescar status nao vira erro de processar.
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.quota) {
        setOutcome({ kind: 'quota', message: cause.quota.message });
        return;
      }
      setOutcome({
        kind: 'error',
        message:
          cause instanceof ApiError
            ? cause.message
            : 'Nao foi possivel processar a vaga.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload() {
    if (outcome.kind !== 'success') {
      return;
    }
    const fileName = fileNameFromPdfUrl(outcome.result.pdf_url);
    if (!fileName) {
      setDownloadState('error');
      setDownloadError('PDF indisponivel para este resultado.');
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    try {
      const bytes = await api.downloadUserFile(fileName);
      if (!isPdfMagic(bytes)) {
        setDownloadState('error');
        setDownloadError(
          'O arquivo baixado nao e um PDF valido. O link nao foi oferecido como sucesso.',
        );
        return;
      }
      triggerBrowserDownload(bytes, fileName);
      setDownloadState('success');
    } catch (cause) {
      setDownloadState('error');
      setDownloadError(
        cause instanceof ApiError
          ? cause.message
          : 'Nao foi possivel baixar o PDF autenticado.',
      );
    } finally {
      setDownloading(false);
    }
  }

  const showPdfButton =
    outcome.kind === 'success' && canOfferPdfDownload(outcome.result);

  return (
    <section
      data-testid="processar-panel"
      className="mt-6 rounded-3xl border-[3px] border-ink bg-sky p-6 shadow-[8px_8px_0_#111]"
    >
      <p className="inline-block rounded-full border-[3px] border-ink bg-paper px-3 py-1 text-xs font-bold">
        POST /processar
      </p>
      <h2 className="mt-4 font-display text-[28px] font-extrabold leading-none text-ink">
        Analise de vaga
      </h2>
      <p className="mt-3 text-sm leading-[1.45] text-ink">
        Cole a descricao completa da vaga. A API devolve aderencia, lacunas e,
        quando o match permite, um PDF otimizado.
      </p>

      <form onSubmit={handleSubmit} className="mt-5">
        <label className="block text-sm text-ink" htmlFor="processar-texto">
          Texto da vaga
        </label>
        <textarea
          id="processar-texto"
          data-testid="processar-texto"
          rows={8}
          disabled={!enabled || submitting}
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder="Cole aqui a descricao completa da vaga para enviar ao /processar..."
          className="mt-1 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-ink disabled:opacity-60"
        />
        <button
          type="submit"
          data-testid="processar-submit"
          disabled={!canSubmit}
          aria-busy={submitting}
          className={`mt-4 w-full rounded-[18px] border-[3px] border-ink px-4 py-3 font-display text-[15px] font-extrabold ${
            canSubmit
              ? 'bg-pink text-ink'
              : 'cursor-not-allowed bg-paper text-muted'
          }`}
        >
          {submitting ? 'Analisando...' : 'Analisar vaga'}
        </button>
      </form>

      {submitting ? (
        <p
          data-testid="processar-loading"
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-ink"
        >
          A API esta analisando a vaga e preparando a resposta.
        </p>
      ) : null}

      {outcome.kind === 'success' ? (
        <div
          data-testid="processar-success"
          className="mt-5 rounded-[18px] border-[3px] border-ink bg-paper p-4"
        >
          <p className="font-display text-lg font-extrabold text-ink">
            Analise concluida
          </p>
          {typeof outcome.result.match_score === 'number' ? (
            <p data-testid="processar-match" className="mt-2 text-sm text-ink">
              Match: {outcome.result.match_score}%
            </p>
          ) : null}
          {outcome.result.texto_resposta ? (
            <pre
              data-testid="processar-resposta"
              className="mt-3 whitespace-pre-wrap font-body text-sm leading-[1.45] text-ink"
            >
              {outcome.result.texto_resposta}
            </pre>
          ) : null}
          {showPdfButton ? (
            <button
              type="button"
              data-testid="download-pdf"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="mt-4 w-full rounded-[18px] border-[3px] border-ink bg-green px-4 py-3 font-display text-[15px] font-extrabold disabled:opacity-60"
            >
              {downloading ? 'Baixando PDF...' : 'Baixar PDF autenticado'}
            </button>
          ) : (
            <p data-testid="processar-no-pdf" className="mt-3 text-sm text-ink">
              Nenhum PDF foi gerado nesta resposta.
            </p>
          )}
          {downloadState === 'success' ? (
            <p
              data-testid="pdf-download-success"
              role="status"
              className="mt-3 text-sm text-ink"
            >
              PDF autenticado conferido (%PDF) e baixado.
            </p>
          ) : null}
          {downloadState === 'error' && downloadError ? (
            <p
              data-testid="pdf-download-error"
              role="alert"
              className="mt-3 text-sm text-ink"
            >
              {downloadError}
            </p>
          ) : null}
        </div>
      ) : null}

      {outcome.kind === 'blocked' ? (
        <div
          data-testid="processar-blocked"
          role="status"
          className="mt-5 rounded-[18px] border-[3px] border-ink bg-paper p-4"
        >
          <p className="font-display text-lg font-extrabold text-ink">
            PDF nao gerado
          </p>
          <p className="mt-2 text-sm leading-[1.45] text-ink">
            A aderencia ficou abaixo do minimo. O servidor bloqueou a geracao
            do curriculo otimizado
            {outcome.result.blocked_reason
              ? ` (${outcome.result.blocked_reason})`
              : ''}
            . Nenhum link de PDF e oferecido.
          </p>
          {outcome.result.texto_resposta ? (
            <pre className="mt-3 whitespace-pre-wrap font-body text-sm leading-[1.45] text-ink">
              {outcome.result.texto_resposta}
            </pre>
          ) : null}
        </div>
      ) : null}

      {outcome.kind === 'quota' ? (
        <div
          data-testid="quota-block"
          role="alert"
          className="mt-5 rounded-[18px] border-[3px] border-ink bg-pink p-4"
        >
          <p className="font-display text-lg font-extrabold text-ink">
            Cota mensal esgotada
          </p>
          <p className="mt-2 text-sm leading-[1.45] text-ink">{outcome.message}</p>
          <p className="mt-2 text-sm text-ink">
            A cota nao e descontada no navegador. Tente de novo so no proximo
            periodo UTC ou apos uma assinatura no servidor.
          </p>
        </div>
      ) : null}

      {outcome.kind === 'error' ? (
        <div
          data-testid="processar-error"
          role="alert"
          className="mt-5 rounded-[18px] border-[3px] border-ink bg-paper p-4"
        >
          <p className="font-display text-lg font-extrabold text-ink">
            Nao foi possivel analisar
          </p>
          <p className="mt-2 text-sm leading-[1.45] text-ink">{outcome.message}</p>
        </div>
      ) : null}
    </section>
  );
}
