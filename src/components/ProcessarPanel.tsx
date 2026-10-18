import { useState, type FormEvent } from 'react';

import { CV_UNAVAILABLE, mentionsRawUnavailable } from '../api/cv';
import { SUBSCRIPTION_REQUIRED } from '../api/quota';
import { ApiError } from '../api/client';
import {
  canOfferPdfDownload,
  fileNameFromPdfUrl,
  isPdfMagic,
  triggerBrowserDownload,
} from '../api/processar';
import type { ProcessarResponse, QuotaCode } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { SubscribeEssencialButton } from './SubscribeEssencialButton';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

type ProcessarOutcome =
  | { kind: 'idle' }
  | { kind: 'success'; result: ProcessarResponse }
  | { kind: 'blocked'; result: ProcessarResponse }
  | { kind: 'quota'; message: string; code: QuotaCode }
  | { kind: 'error'; message: string };

const PROCESSAR_FAILED = 'Não foi possível analisar a vaga.';

function publicProcessarMessage(message: string, fallback = PROCESSAR_FAILED): string {
  if (mentionsRawUnavailable(message)) {
    return CV_UNAVAILABLE;
  }
  const lower = message.toLowerCase();
  if (
    /https?:\/\//i.test(message) ||
    /[/\\]/.test(message) ||
    /\b(post|get|put|patch|delete)\b/i.test(message) ||
    lower.includes('bearer') ||
    lower.includes('has_cv') ||
    lower.includes('endpoint') ||
    lower.includes('json')
  ) {
    return fallback;
  }
  const trimmed = message.trim();
  return trimmed || fallback;
}

function publicBlockedReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim() ?? '';
  const safe = publicProcessarMessage(trimmed);
  if (!trimmed || safe === PROCESSAR_FAILED) {
    return '';
  }
  return ` (${safe})`;
}

type ProcessarPanelProps = {
  enabled: boolean;
  blockedMessage?: string | null;
  onProcessed: () => Promise<void>;
  allowSubscriptionCta?: boolean;
};

export function ProcessarPanel({
  enabled,
  blockedMessage,
  onProcessed,
  allowSubscriptionCta = false,
}: ProcessarPanelProps) {
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
        setOutcome({
          kind: 'quota',
          message: cause.quota.message,
          code: cause.quota.code,
        });
        return;
      }
      setOutcome({
        kind: 'error',
        message:
          cause instanceof ApiError
            ? publicProcessarMessage(cause.message)
            : PROCESSAR_FAILED,
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
      setDownloadError('PDF indisponível para este resultado.');
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    try {
      const bytes = await api.downloadUserFile(fileName);
      if (!isPdfMagic(bytes)) {
        setDownloadState('error');
        setDownloadError(
          'O arquivo baixado não é um PDF válido.',
        );
        return;
      }
      triggerBrowserDownload(bytes, fileName);
      setDownloadState('success');
    } catch (cause) {
      setDownloadState('error');
      setDownloadError(
        cause instanceof ApiError
          ? publicProcessarMessage(cause.message, 'Não foi possível baixar o PDF.')
          : 'Não foi possível baixar o PDF.',
      );
    } finally {
      setDownloading(false);
    }
  }

  const showPdfButton =
    outcome.kind === 'success' && canOfferPdfDownload(outcome.result);

  return (
    <Card id="analise" data-testid="processar-panel" className="mt-6 scroll-mt-24">
      <CardHeader>
        <CardTitle>Análise de vaga</CardTitle>
        <CardDescription className="text-foreground">
          Cole a descrição completa da vaga. Você vê a aderência, as lacunas e,
          quando o match permite, um PDF otimizado.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {!enabled && blockedMessage ? (
          <Alert data-testid="processar-gate" role="status" className="mb-4">
            <AlertDescription>{blockedMessage}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit}>
          <Label htmlFor="processar-texto">Texto da vaga</Label>
          <Textarea
            id="processar-texto"
            data-testid="processar-texto"
            rows={8}
            disabled={submitting}
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder="Cole aqui a descrição completa da vaga..."
            className="mt-1.5"
          />
          <Button
            type="submit"
            data-testid="processar-submit"
            disabled={!canSubmit}
            aria-busy={submitting}
            className="mt-4 w-full"
            size="lg"
          >
            {submitting ? 'Analisando...' : 'Analisar vaga'}
          </Button>
        </form>

        {submitting ? (
          <p
            data-testid="processar-loading"
            role="status"
            aria-live="polite"
            className="mt-4 text-sm text-muted-foreground"
          >
            A análise está em andamento.
          </p>
        ) : null}

        {outcome.kind === 'success' ? (
          <div
            data-testid="processar-success"
            className="mt-5 rounded-lg border border-border bg-muted/60 p-4"
          >
            <p className="font-display text-base font-semibold">
              Análise concluída
            </p>
            {typeof outcome.result.match_score === 'number' ? (
              <p data-testid="processar-match" className="mt-2 text-sm">
                Match: {outcome.result.match_score}%
              </p>
            ) : null}
            {outcome.result.texto_resposta ? (
              <pre
                data-testid="processar-resposta"
                className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed"
              >
                {outcome.result.texto_resposta}
              </pre>
            ) : null}
            {showPdfButton ? (
              <Button
                type="button"
                data-testid="download-pdf"
                onClick={() => void handleDownload()}
                disabled={downloading}
                className="mt-4 w-full"
              >
                {downloading ? 'Baixando PDF...' : 'Baixar PDF'}
              </Button>
            ) : (
              <p data-testid="processar-no-pdf" className="mt-3 text-sm">
                Nenhum PDF foi gerado nesta resposta.
              </p>
            )}
            {downloadState === 'success' ? (
              <p
                data-testid="pdf-download-success"
                role="status"
                className="mt-3 text-sm"
              >
                PDF baixado.
              </p>
            ) : null}
            {downloadState === 'error' && downloadError ? (
              <Alert
                data-testid="pdf-download-error"
                variant="destructive"
                className="mt-3"
              >
                <AlertDescription>{downloadError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {outcome.kind === 'blocked' ? (
          <Alert
            data-testid="processar-blocked"
            role="status"
            variant="warning"
            className="mt-5"
          >
            <AlertTitle>PDF não gerado</AlertTitle>
            <AlertDescription className="mt-2">
              A aderência ficou abaixo do mínimo. O currículo otimizado não foi
              gerado
              {publicBlockedReason(outcome.result.blocked_reason)}
              . Nenhum PDF é oferecido.
            </AlertDescription>
            {outcome.result.texto_resposta ? (
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {outcome.result.texto_resposta}
              </pre>
            ) : null}
          </Alert>
        ) : null}

        {outcome.kind === 'quota' ? (
          <Alert data-testid="quota-block" variant="destructive" className="mt-5">
            <AlertTitle>Cota mensal esgotada</AlertTitle>
            <AlertDescription className="mt-2">
              <p>{outcome.message}</p>
              <p className="mt-2">
                A cota não é descontada nesta tela. Tente de novo no próximo
                período ou depois de assinar.
              </p>
            </AlertDescription>
            {outcome.code === SUBSCRIPTION_REQUIRED ? (
              <SubscribeEssencialButton blocked={!allowSubscriptionCta} />
            ) : null}
          </Alert>
        ) : null}

        {outcome.kind === 'error' ? (
          <Alert data-testid="processar-error" variant="destructive" className="mt-5">
            <AlertTitle>Não foi possível analisar</AlertTitle>
            <AlertDescription className="mt-2">{outcome.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
