import { useState, type FormEvent, type ReactNode } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LegalDoc, type LegalDocId } from '../legal/versions';
import { LegalDocument } from './LegalDocument';

export function ConsentGate({ children }: { children: ReactNode }) {
  const { blocksApp, isAuthenticated } = useAuth();

  return (
    <>
      <div
        aria-hidden={blocksApp}
        className={blocksApp ? 'pointer-events-none select-none' : undefined}
      >
        {children}
      </div>
      {isAuthenticated && blocksApp ? <ConsentReacceptOverlay /> : null}
    </>
  );
}

function ConsentReacceptOverlay() {
  const { outdated, acceptOutdatedConsent, logout } = useAuth();
  const docs = uniqueDocs(outdated.map((item) => item.doc));
  const [accepted, setAccepted] = useState<Record<LegalDocId, boolean>>({
    terms: false,
    privacy: false,
  });
  const [loaded, setLoaded] = useState<Record<LegalDocId, boolean>>({
    terms: false,
    privacy: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    docs.length > 0 &&
    docs.every((doc) => accepted[doc] && loaded[doc]) &&
    !submitting;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!docs.every((doc) => accepted[doc] && loaded[doc])) {
      setError('Leia e marque os documentos vigentes para continuar.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await acceptOutdatedConsent(docs);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Falha ao registrar o aceite.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="consent-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-gate-title"
      className="fixed inset-0 z-50 overflow-auto bg-cream"
    >
      <div className="mx-auto min-h-dvh max-w-xl px-5 pb-7 pt-5">
        <p className="font-display text-xl font-extrabold text-ink">
          Atualizar aceites
        </p>

        <section className="mt-5 rounded-3xl border-[3px] border-ink bg-yellow p-6 shadow-[8px_8px_0_#111]">
          <h2
            id="consent-gate-title"
            className="font-display text-[32px] font-extrabold leading-none text-ink"
          >
            Documentos legais atualizados
          </h2>
          <p className="mt-3 text-base leading-[1.45] text-ink">
            Suas versoes aceitas nao sao as vigentes. Leia o texto carregado da
            API, marque os checkboxes e confirme. O app fica bloqueado ate o
            reaceite via POST /consent.
          </p>
        </section>

        <form
          onSubmit={handleSubmit}
          className="mt-5 rounded-3xl border-[3px] border-ink bg-paper p-5 shadow-[8px_8px_0_#111]"
        >
          <h3 className="font-display text-[22px] font-extrabold text-ink">
            Versoes vigentes
          </h3>
          <p className="mt-1 text-sm text-muted">Termos 1.0 e privacidade 1.0.</p>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-ink">
              {error}
            </p>
          ) : null}

          <div className="mt-4">
            {docs.includes(LegalDoc.terms) ? (
              <LegalDocument
                doc={LegalDoc.terms}
                accepted={accepted.terms}
                onAcceptedChange={(value) =>
                  setAccepted((prev) => ({ ...prev, terms: value }))
                }
                onLoadedChange={(value) =>
                  setLoaded((prev) => ({ ...prev, terms: value }))
                }
                enabled={!submitting}
              />
            ) : null}
            {docs.includes(LegalDoc.privacy) ? (
              <LegalDocument
                doc={LegalDoc.privacy}
                accepted={accepted.privacy}
                onAcceptedChange={(value) =>
                  setAccepted((prev) => ({ ...prev, privacy: value }))
                }
                onLoadedChange={(value) =>
                  setLoaded((prev) => ({ ...prev, privacy: value }))
                }
                enabled={!submitting}
              />
            ) : null}
          </div>

          <button
            type="submit"
            data-testid="reacceptConsentButton"
            disabled={!canSubmit}
            className={`mt-2 w-full rounded-[18px] border-[3px] border-ink px-4 py-3 font-display text-[15px] font-extrabold ${
              canSubmit
                ? 'bg-green'
                : 'cursor-not-allowed bg-paper text-muted'
            }`}
          >
            {submitting ? 'Enviando aceites...' : 'Aceitar e continuar'}
          </button>
          <button
            type="button"
            data-testid="consent-logout"
            onClick={logout}
            className="mt-3 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 font-display text-[15px] font-extrabold"
          >
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}

function uniqueDocs(docs: LegalDocId[]): LegalDocId[] {
  return [...new Set(docs)];
}
