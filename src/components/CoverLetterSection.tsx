import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  COVER_LETTER_COMPANY_REQUIRED,
  COVER_LETTER_COPY_FAILED,
  COVER_LETTER_COPY_SUCCESS,
  COVER_LETTER_CV_GUIDANCE,
  COVER_LETTER_DOWNLOAD_FAILED,
  COVER_LETTER_FAILED,
  COVER_LETTER_MISSING_COMPANY,
  COVER_LETTER_PDF_INVALID,
  COVER_LETTER_QUOTA,
  COVER_LETTER_RATE_LIMIT,
  COVER_LETTER_STATUS_CHECK_FAILED,
  coverLetterFileName,
  isCoverLetterCvContextError,
  isCoverLetterEmptyCompanyError,
  safeCoverLetterDownloadMessage,
} from '../api/coverLetter';
import { isPdfMagic, triggerBrowserDownload } from '../api/processar';
import { useAuth } from '../auth/AuthContext';
import { APP_CURRICULUM } from '../auth/returnTo';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

type CoverLetterPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; text: string; pdfUrl: string }
  | { kind: 'error'; message: string }
  | { kind: 'quota'; message: string };

type CopyFeedback = 'success' | 'error' | null;

type CoverLetterSectionProps = {
  companyName?: string;
  /** `analysis` vem do histórico. `standalone` pede só a empresa, sem cargo. */
  variant?: 'analysis' | 'standalone';
  /** No modo avulso, só true libera o POST. O histórico ignora este valor. */
  canGenerate?: boolean;
  /** Orientação de CV quando o status já disse que não há embeddings. */
  showCvGate?: boolean;
};

export function CoverLetterSection({
  companyName,
  variant = 'analysis',
  canGenerate = true,
  showCvGate = false,
}: CoverLetterSectionProps) {
  const standalone = variant === 'standalone';
  const { api, expireSession } = useAuth();
  const [empresaInput, setEmpresaInput] = useState('');
  const company = standalone ? empresaInput.trim() : (companyName?.trim() ?? '');
  const [phase, setPhase] = useState<CoverLetterPhase>({ kind: 'idle' });
  const [focusTick, setFocusTick] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [companyInvalid, setCompanyInvalid] = useState(false);
  const [cvBlocked, setCvBlocked] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const generateLock = useRef(false);
  const downloadLock = useRef(false);
  const loadingRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const companyErrorRef = useRef<HTMLParagraphElement>(null);
  const hintId = useId();
  const companyErrorId = useId();
  const gateId = useId();
  const inputId = useId();
  const titleId = useId();

  const generating = phase.kind === 'loading';
  const showGate = standalone && (showCvGate || cvBlocked);
  const allowed = !standalone || (canGenerate && !cvBlocked);
  const busy = generating || downloading || rechecking;

  // O loading sai do DOM com o foco e o botão volta a ser habilitado.
  // O navegador devolve o foco num task seguinte. O próximo task ganha essa corrida.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (phase.kind === 'loading') {
        loadingRef.current?.focus();
      } else if (phase.kind === 'ready') {
        resultRef.current?.focus();
      } else if (phase.kind === 'error' || phase.kind === 'quota') {
        errorRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [phase.kind, focusTick]);

  useEffect(() => {
    if (!standalone || phase.kind !== 'idle') {
      return;
    }
    const timer = window.setTimeout(() => {
      if (cvBlocked) {
        gateRef.current?.focus();
      } else if (companyInvalid && !company) {
        companyErrorRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [standalone, phase.kind, cvBlocked, companyInvalid, company, focusTick]);

  function showQuota() {
    setPhase({ kind: 'quota', message: COVER_LETTER_QUOTA });
    setFocusTick((tick) => tick + 1);
  }

  function showError(message: string) {
    setPhase({ kind: 'error', message });
    setFocusTick((tick) => tick + 1);
  }

  async function generate() {
    if (generateLock.current || downloading || rechecking) {
      return;
    }
    if (!company) {
      if (standalone) {
        setCompanyInvalid(true);
        setFocusTick((tick) => tick + 1);
      }
      return;
    }
    if (!allowed) {
      return;
    }
    generateLock.current = true;
    setCopyFeedback(null);
    setDownloadError(null);
    setDownloadSuccess(false);
    try {
      if (standalone) {
        setRechecking(true);
        try {
          const status = await api.getStatus();
          if (status.has_embeddings !== true) {
            setCvBlocked(true);
            setPhase({ kind: 'idle' });
            setFocusTick((tick) => tick + 1);
            return;
          }
        } catch (cause) {
          if (cause instanceof ApiError && cause.outdated) {
            return;
          }
          if (cause instanceof ApiError && cause.status === 401) {
            expireSession();
            return;
          }
          showError(COVER_LETTER_STATUS_CHECK_FAILED);
          return;
        } finally {
          setRechecking(false);
        }
      }

      setPhase({ kind: 'loading' });
      setFocusTick((tick) => tick + 1);
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
        expireSession();
        return;
      }
      if (standalone && cause instanceof ApiError && cause.status === 429) {
        showError(COVER_LETTER_RATE_LIMIT);
        return;
      }
      if (standalone && cause instanceof ApiError && isCoverLetterCvContextError(cause)) {
        setCvBlocked(true);
        setPhase({ kind: 'idle' });
        setFocusTick((tick) => tick + 1);
        return;
      }
      if (standalone && cause instanceof ApiError && isCoverLetterEmptyCompanyError(cause)) {
        setCompanyInvalid(true);
        setPhase({ kind: 'idle' });
        setFocusTick((tick) => tick + 1);
        return;
      }
      if (standalone && cause instanceof ApiError && (cause.status === 402 || cause.quota)) {
        showError(COVER_LETTER_FAILED);
        return;
      }
      if (
        !standalone &&
        cause instanceof ApiError &&
        (cause.status === 402 || cause.status === 429 || cause.quota)
      ) {
        showQuota();
        return;
      }
      showError(cause instanceof ApiError ? cause.message : COVER_LETTER_FAILED);
    } finally {
      generateLock.current = false;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void generate();
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
        expireSession();
        return;
      }
      if (standalone && cause instanceof ApiError && cause.status === 429) {
        setDownloadError(COVER_LETTER_RATE_LIMIT);
        return;
      }
      if (standalone && cause instanceof ApiError && (cause.status === 402 || cause.quota)) {
        setDownloadError(COVER_LETTER_DOWNLOAD_FAILED);
        return;
      }
      if (
        !standalone &&
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

  const companyErrorVisible = standalone && companyInvalid && !company;
  const describedBy = standalone
    ? [hintId, companyErrorVisible ? companyErrorId : null, showGate ? gateId : null]
        .filter(Boolean)
        .join(' ')
    : company
      ? undefined
      : hintId;

  const generateButton = (
    <Button
      type={standalone ? 'submit' : 'button'}
      data-testid="cover-letter-generate"
      onClick={standalone ? undefined : () => void generate()}
      disabled={!company || busy || !allowed}
      aria-busy={generating || rechecking}
      aria-describedby={describedBy}
      className={standalone ? 'w-full sm:w-auto' : 'w-full'}
    >
      {generating ? 'Gerando carta...' : 'Gerar carta'}
    </Button>
  );

  return (
    <div
      data-testid="cover-letter-section"
      className={standalone ? 'grid gap-4' : 'mt-4 border-t border-border pt-4'}
    >
      {standalone ? (
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>Empresa</Label>
            <Input
              id={inputId}
              name="empresa"
              data-testid="cover-letter-company"
              value={empresaInput}
              autoComplete="organization"
              aria-required="true"
              aria-invalid={companyErrorVisible}
              aria-describedby={describedBy}
              className="w-full"
              onChange={(event) => {
                const next = event.target.value;
                setEmpresaInput(next);
                if (next.trim()) {
                  setCompanyInvalid(false);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return;
                }
                event.preventDefault();
                void generate();
              }}
            />
            <p id={hintId} className="text-sm leading-relaxed text-muted-foreground">
              Informe o nome da empresa para gerar a carta.
            </p>
            {companyErrorVisible ? (
              <p
                ref={companyErrorRef}
                tabIndex={-1}
                id={companyErrorId}
                data-testid="cover-letter-company-error"
                role="alert"
                aria-live="polite"
                className="text-sm text-destructive outline-none"
              >
                {COVER_LETTER_COMPANY_REQUIRED}
              </p>
            ) : null}
          </div>
          {showGate ? (
            <div
              ref={gateRef}
              tabIndex={-1}
              id={gateId}
              data-testid="cover-letter-cv-gate"
              role="status"
              aria-live="polite"
              className="rounded-lg border border-border bg-muted p-4 outline-none"
            >
              <p className="text-sm leading-relaxed">{COVER_LETTER_CV_GUIDANCE}</p>
              <Button asChild variant="outline" className="mt-3 w-full sm:w-auto">
                <Link to={APP_CURRICULUM} data-testid="cover-letter-cv-link">
                  Ir para o currículo
                </Link>
              </Button>
            </div>
          ) : null}
          {generateButton}
        </form>
      ) : (
        generateButton
      )}

      {!standalone && !company ? (
        <p
          id={hintId}
          data-testid="cover-letter-missing-company"
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
        >
          {COVER_LETTER_MISSING_COMPANY}
        </p>
      ) : null}

      {rechecking ? (
        <p
          data-testid="cover-letter-recheck"
          role="status"
          aria-live="polite"
          className="text-sm"
        >
          Verificando o currículo...
        </p>
      ) : null}

      {generating ? (
        <p
          ref={loadingRef}
          tabIndex={-1}
          data-testid="cover-letter-loading"
          role="status"
          aria-live="polite"
          className={standalone ? 'text-sm outline-none' : 'mt-3 text-sm outline-none'}
        >
          Gerando a carta de apresentação...
        </p>
      ) : null}

      {phase.kind === 'ready' ? (
        <section
          ref={resultRef}
          tabIndex={-1}
          aria-labelledby={titleId}
          aria-live="polite"
          data-testid="cover-letter-result"
          className={
            standalone
              ? 'rounded-lg border border-border bg-muted p-4 outline-none'
              : 'mt-4 rounded-lg border border-border bg-muted p-4 outline-none'
          }
        >
          <h4 id={titleId} className="font-display text-lg font-semibold break-words">
            Carta de apresentação
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
            <p data-testid="cover-letter-download-error" role="alert" aria-live="polite" className="text-sm">
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
          aria-live="polite"
          className={standalone ? 'outline-none' : 'mt-4 outline-none'}
        >
          <AlertTitle>Não foi possível gerar a carta</AlertTitle>
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
