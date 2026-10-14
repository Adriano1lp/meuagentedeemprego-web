import { useEffect, useId, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  COVER_LETTER_COPY_FAILED,
  COVER_LETTER_COPY_SUCCESS,
  COVER_LETTER_DOWNLOAD_FAILED,
  COVER_LETTER_FAILED,
  COVER_LETTER_MISSING_COMPANY,
  COVER_LETTER_PDF_INVALID,
  COVER_LETTER_QUOTA,
  coverLetterFileName,
  safeCoverLetterDownloadMessage,
} from '../api/coverLetter';
import { isPdfMagic, triggerBrowserDownload } from '../api/processar';
import { useAuth } from '../auth/AuthContext';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

type CoverLetterPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; text: string; pdfUrl: string }
  | { kind: 'error'; message: string }
  | { kind: 'quota'; message: string };

type CopyFeedback = 'success' | 'error' | null;

type CoverLetterSectionProps = {
  companyName?: string;
};

export function CoverLetterSection({ companyName }: CoverLetterSectionProps) {
  const { api, logout } = useAuth();
  const company = companyName?.trim() ?? '';
  const [phase, setPhase] = useState<CoverLetterPhase>({ kind: 'idle' });
  const [focusTick, setFocusTick] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const generateLock = useRef(false);
  const downloadLock = useRef(false);
  const loadingRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const titleId = useId();

  const generating = phase.kind === 'loading';
  const busy = generating || downloading;

  useEffect(() => {
    if (phase.kind === 'loading') {
      loadingRef.current?.focus();
    } else if (phase.kind === 'ready') {
      resultRef.current?.focus();
    } else if (phase.kind === 'error' || phase.kind === 'quota') {
      errorRef.current?.focus();
    }
  }, [phase.kind, focusTick]);

  function showQuota() {
    setPhase({ kind: 'quota', message: COVER_LETTER_QUOTA });
    setFocusTick((tick) => tick + 1);
  }

  async function generate() {
    if (!company || generateLock.current || downloading) {
      return;
    }
    generateLock.current = true;
    setCopyFeedback(null);
    setDownloadError(null);
    setDownloadSuccess(false);
    setPhase({ kind: 'loading' });
    setFocusTick((tick) => tick + 1);
    try {
      const result = await api.createCoverLetter(company);
      setPhase({
        kind: 'ready',
        text: result.texto_resposta,
        pdfUrl: result.pdf_url,
      });
      setFocusTick((tick) => tick + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        setPhase({ kind: 'idle' });
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        logout();
        return;
      }
      if (
        cause instanceof ApiError &&
        (cause.status === 402 || cause.status === 429 || cause.quota)
      ) {
        showQuota();
        return;
      }
      setPhase({
        kind: 'error',
        message:
          cause instanceof ApiError ? cause.message : COVER_LETTER_FAILED,
      });
      setFocusTick((tick) => tick + 1);
    } finally {
      generateLock.current = false;
    }
  }

  async function copyLetter() {
    if (phase.kind !== 'ready') {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard');
      }
      await navigator.clipboard.writeText(phase.text);
      setCopyFeedback('success');
    } catch {
      setCopyFeedback('error');
    }
  }

  async function downloadPdf() {
    if (phase.kind !== 'ready' || downloadLock.current || generating) {
      return;
    }
    const fileName = coverLetterFileName(phase.pdfUrl);
    if (!fileName) {
      setDownloadSuccess(false);
      setDownloadError(COVER_LETTER_DOWNLOAD_FAILED);
      return;
    }
    downloadLock.current = true;
    setDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(false);
    try {
      const bytes = await api.downloadUserFile(fileName);
      if (!isPdfMagic(bytes)) {
        setDownloadError(COVER_LETTER_PDF_INVALID);
        return;
      }
      triggerBrowserDownload(bytes, fileName);
      setDownloadSuccess(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        logout();
        return;
      }
      if (
        cause instanceof ApiError &&
        (cause.status === 402 || cause.status === 429 || cause.quota)
      ) {
        showQuota();
        return;
      }
      setDownloadError(
        cause instanceof ApiError
          ? safeCoverLetterDownloadMessage(cause)
          : COVER_LETTER_DOWNLOAD_FAILED,
      );
    } finally {
      downloadLock.current = false;
      setDownloading(false);
    }
  }

  return (
    <div data-testid="cover-letter-section" className="mt-4 border-t border-border pt-4">
      <Button
        type="button"
        data-testid="cover-letter-generate"
        onClick={() => void generate()}
        disabled={!company || busy}
        aria-busy={generating}
        aria-describedby={company ? undefined : hintId}
        className="w-full"
      >
        {generating ? 'Gerando carta...' : 'Gerar carta'}
      </Button>

      {!company ? (
        <p
          id={hintId}
          data-testid="cover-letter-missing-company"
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
        >
          {COVER_LETTER_MISSING_COMPANY}
        </p>
      ) : null}

      {generating ? (
        <p
          ref={loadingRef}
          tabIndex={-1}
          data-testid="cover-letter-loading"
          role="status"
          aria-live="polite"
          className="mt-3 text-sm outline-none"
        >
          Gerando a carta de apresentacao...
        </p>
      ) : null}

      {phase.kind === 'ready' ? (
        <section
          ref={resultRef}
          tabIndex={-1}
          aria-labelledby={titleId}
          data-testid="cover-letter-result"
          className="mt-4 rounded-lg border border-border bg-muted p-4 outline-none"
        >
          <h4 id={titleId} className="font-display text-lg font-semibold break-words">
            Carta de apresentacao
            {company ? ` para ${company}` : ''}
          </h4>
          <pre
            data-testid="cover-letter-text"
            className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed"
          >
            {phase.text}
          </pre>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              data-testid="cover-letter-copy"
              onClick={() => void copyLetter()}
              variant="secondary"
              className="w-full"
            >
              Copiar
            </Button>
            <Button
              type="button"
              data-testid="cover-letter-download"
              onClick={() => void downloadPdf()}
              disabled={downloading}
              aria-busy={downloading}
              variant="outline"
              className="w-full"
            >
              {downloading ? 'Baixando PDF...' : 'Baixar PDF'}
            </Button>
          </div>
          <p
            data-testid="cover-letter-copy-status"
            role="status"
            aria-live="polite"
            className="mt-3 text-sm"
          >
            {copyFeedback === 'success'
              ? COVER_LETTER_COPY_SUCCESS
              : copyFeedback === 'error'
                ? COVER_LETTER_COPY_FAILED
                : ''}
          </p>
          {downloadSuccess ? (
            <p
              data-testid="cover-letter-download-success"
              role="status"
              aria-live="polite"
              className="text-sm"
            >
              PDF da carta baixado.
            </p>
          ) : null}
          {downloadError ? (
            <p data-testid="cover-letter-download-error" role="alert" className="text-sm">
              {downloadError}
            </p>
          ) : null}
        </section>
      ) : null}

      {phase.kind === 'error' ? (
        <Alert
          ref={errorRef}
          tabIndex={-1}
          data-testid="cover-letter-error"
          variant="destructive"
          className="mt-4 outline-none"
        >
          <AlertTitle>Nao foi possivel gerar a carta</AlertTitle>
          <AlertDescription className="mt-2">{phase.message}</AlertDescription>
          <Button
            type="button"
            data-testid="cover-letter-retry"
            onClick={() => void generate()}
            variant="outline"
            className="mt-4 w-full sm:w-auto"
          >
            Tentar de novo
          </Button>
        </Alert>
      ) : null}

      {phase.kind === 'quota' ? (
        <Alert
          ref={errorRef}
          tabIndex={-1}
          data-testid="cover-letter-quota"
          variant="destructive"
          className="mt-4 outline-none"
        >
          <AlertTitle>Limite de uso</AlertTitle>
          <AlertDescription className="mt-2">{phase.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
