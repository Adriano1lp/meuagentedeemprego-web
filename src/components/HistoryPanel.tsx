import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  formatHistoryDate,
  HISTORY_CV_DOWNLOAD_FAILED,
  HISTORY_DOWNLOAD_INVALID,
  HISTORY_LOAD_FAILED,
  HISTORY_PDF_DOWNLOAD_FAILED,
  historyDownloadErrorLeaksInternals,
  historyJobPdfFileName,
  safeHistoryDownloadMessage,
  safeHistoryErrorMessage,
} from '../api/history';
import {
  downloadMimeType,
  isPdfMagic,
  triggerBrowserDownload,
} from '../api/processar';
import type { GapHistoryItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CoverLetterSection } from './CoverLetterSection';
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

type HistoryView =
  | { kind: 'loading' }
  | { kind: 'list'; items: GapHistoryItem[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export function HistoryPanel() {
  const { api, isAuthenticated, blocksApp } = useAuth();
  const [view, setView] = useState<HistoryView>({ kind: 'loading' });
  const canLoad = isAuthenticated && !blocksApp;

  const loadHistory = useCallback(async () => {
    if (!canLoad) {
      return;
    }
    setView({ kind: 'loading' });
    try {
      const response = await api.getGapHistory();
      setView(
        response.items.length > 0
          ? { kind: 'list', items: response.items }
          : { kind: 'empty' },
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      setView({
        kind: 'error',
        message: safeHistoryErrorMessage(cause),
      });
    }
  }, [api, canLoad]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <Card
      data-testid="history-panel"
      aria-labelledby="history-title"
    >
      <CardHeader>
        <Badge variant="outline">Analises desta conta</Badge>
        <CardTitle id="history-title">Historico</CardTitle>
        <CardDescription className="text-foreground">
          Analises anteriores desta conta: titulo, empresa, aderencia e data.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {view.kind === 'loading' ? (
          <p
            data-testid="history-loading"
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            Carregando historico...
          </p>
        ) : null}

        {view.kind === 'empty' ? (
          <Alert data-testid="history-empty" role="status">
            <AlertTitle>Nenhum retorno salvo ainda.</AlertTitle>
            <AlertDescription className="mt-2 text-muted-foreground">
              Quando o assistente analisar uma vaga, o titulo, a empresa, a
              aderencia e a data aparecem aqui.
            </AlertDescription>
          </Alert>
        ) : null}

        {view.kind === 'error' ? (
          <Alert data-testid="history-error" variant="destructive">
            <AlertTitle>Nao foi possivel carregar o historico.</AlertTitle>
            <AlertDescription className="mt-2">
              {view.message || HISTORY_LOAD_FAILED}
            </AlertDescription>
            <Button
              type="button"
              data-testid="history-retry"
              onClick={() => void loadHistory()}
              variant="outline"
              size="sm"
              className="mt-4"
            >
              Tentar novamente
            </Button>
          </Alert>
        ) : null}

        {view.kind === 'list' ? (
          <ul data-testid="history-list" className="grid gap-4">
            {view.items.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HistoryCard({ item }: { item: GapHistoryItem }) {
  const formattedDate = formatHistoryDate(item.created_at);
  const title = item.job_title?.trim() || 'Analise sem titulo';

  return (
    <li>
      <article
        data-testid="history-item"
        className="rounded-xl border border-border bg-background p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3
            data-testid="history-item-title"
            className="font-display text-lg font-semibold break-words"
          >
            {title}
          </h3>
          {formattedDate && item.created_at ? (
            <time
              data-testid="history-item-date"
              dateTime={item.created_at}
              className="text-sm text-muted-foreground"
            >
              {formattedDate}
            </time>
          ) : null}
        </div>

        {item.company_name ? (
          <p data-testid="history-item-company" className="mt-2 break-words text-sm">
            Empresa: {item.company_name}
          </p>
        ) : null}

        <p data-testid="history-item-score" className="mt-2 text-sm">
          Aderencia: {item.match_score}/100
        </p>

        {item.generation_blocked ? (
          <p data-testid="history-item-blocked" className="mt-2 text-sm">
            {item.blocked_reason
              ? `PDF nao gerado: ${item.blocked_reason}`
              : 'PDF nao gerado.'}
          </p>
        ) : null}

        {item.job_summary ? (
          <p
            data-testid="history-item-summary"
            className="mt-3 break-words text-sm leading-relaxed"
          >
            {item.job_summary}
          </p>
        ) : null}

        {item.strengths.length > 0 ? (
          <p className="mt-3 break-words text-sm">
            Pontos fortes: {item.strengths.join(', ')}
          </p>
        ) : null}

        {item.critical_gaps.length > 0 ? (
          <p className="mt-2 break-words text-sm">
            Lacunas criticas: {item.critical_gaps.join(', ')}
          </p>
        ) : null}

        <HistoryDownloads item={item} title={title} />

        <CoverLetterSection companyName={item.company_name} />
      </article>
    </li>
  );
}

function HistoryDownloads({
  item,
  title,
}: {
  item: GapHistoryItem;
  title: string;
}) {
  const cvFileName = item.cv_file_name;
  const pdfFileName = historyJobPdfFileName(item);
  if (!cvFileName && !pdfFileName) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      {cvFileName ? (
        <HistoryDownloadButton
          fileName={cvFileName}
          idleLabel="Baixar CV"
          busyLabel="Baixando CV..."
          successLabel="CV baixado."
          failedMessage={HISTORY_CV_DOWNLOAD_FAILED}
          requirePdf={cvFileName.toLowerCase().endsWith('.pdf')}
          tone="yellow"
          testId="history-cv-download"
          errorTestId="history-cv-download-error"
          successTestId="history-cv-download-success"
          describedTitle={title}
        />
      ) : null}
      {pdfFileName ? (
        <HistoryDownloadButton
          fileName={pdfFileName}
          idleLabel="Baixar PDF da vaga"
          busyLabel="Baixando PDF..."
          successLabel="PDF da vaga baixado."
          failedMessage={HISTORY_PDF_DOWNLOAD_FAILED}
          requirePdf
          tone="paper"
          testId="history-pdf-download"
          errorTestId="history-pdf-download-error"
          successTestId="history-pdf-download-success"
          describedTitle={title}
        />
      ) : null}
    </div>
  );
}

function HistoryDownloadButton({
  fileName,
  idleLabel,
  busyLabel,
  successLabel,
  failedMessage,
  requirePdf,
  tone,
  testId,
  errorTestId,
  successTestId,
  describedTitle,
}: {
  fileName: string;
  idleLabel: string;
  busyLabel: string;
  successLabel: string;
  failedMessage: string;
  requirePdf: boolean;
  tone: 'yellow' | 'paper';
  testId: string;
  errorTestId: string;
  successTestId: string;
  describedTitle: string;
}) {
  const { api, logout } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const lock = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  async function onDownload() {
    if (!fileName || lock.current) {
      return;
    }
    lock.current = true;
    setDownloading(true);
    setError(null);
    setSuccess(false);
    try {
      const bytes = await api.downloadUserFile(fileName);
      if (bytes.byteLength === 0) {
        setError(failedMessage);
        return;
      }
      if (requirePdf && !isPdfMagic(bytes)) {
        setError(HISTORY_DOWNLOAD_INVALID);
        return;
      }
      triggerBrowserDownload(
        bytes,
        fileName,
        undefined,
        undefined,
        undefined,
        downloadMimeType(fileName, requirePdf),
      );
      setSuccess(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        logout();
        return;
      }
      const message = safeHistoryDownloadMessage(cause, failedMessage);
      setError(
        historyDownloadErrorLeaksInternals(message) ? failedMessage : message,
      );
    } finally {
      lock.current = false;
      setDownloading(false);
    }
  }

  const accessibleName = downloading
    ? `${busyLabel} ${describedTitle}`
    : `${idleLabel} da analise ${describedTitle}`;

  return (
    <div className="w-full sm:min-w-0 sm:flex-1">
      <Button
        type="button"
        data-testid={testId}
        onClick={() => void onDownload()}
        disabled={downloading}
        aria-busy={downloading}
        aria-label={accessibleName}
        variant={tone === 'paper' ? 'outline' : 'secondary'}
        className="w-full"
      >
        {downloading ? busyLabel : idleLabel}
      </Button>
      {success ? (
        <p
          data-testid={successTestId}
          role="status"
          aria-live="polite"
          className="mt-2 text-sm"
        >
          {successLabel}
        </p>
      ) : null}
      {error ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          data-testid={errorTestId}
          role="alert"
          className="mt-2 text-sm leading-relaxed outline-none"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
