import { useState, type FormEvent, type ReactNode } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LegalDoc, type LegalDocId } from '../legal/versions';
import { LegalDocument } from './LegalDocument';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';

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
      className="fixed inset-0 z-50 overflow-auto bg-background"
    >
      <div className="mx-auto min-h-dvh w-full max-w-lg px-4 py-8">
        <p className="font-display text-xl font-semibold">Atualizar aceites</p>

        <Card className="mt-5">
          <CardHeader className="pb-5 md:pb-6">
            <CardTitle id="consent-gate-title">
              Documentos legais atualizados
            </CardTitle>
            <CardDescription className="text-foreground">
              Suas versoes aceitas nao sao as vigentes. Leia o texto carregado da
              API, marque os checkboxes e confirme. O app fica bloqueado ate o
              reaceite via POST /consent.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="mt-5">
          <form onSubmit={handleSubmit} className="px-5 py-5 md:px-6">
            <h3 className="font-display text-lg font-semibold">
              Versoes vigentes
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Termos 1.0 e privacidade 1.0.
            </p>

            {error ? (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
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

            <Button
              type="submit"
              data-testid="reacceptConsentButton"
              disabled={!canSubmit}
              className="mt-2 w-full"
              size="lg"
            >
              {submitting ? 'Enviando aceites...' : 'Aceitar e continuar'}
            </Button>
            <Button
              type="button"
              data-testid="consent-logout"
              onClick={logout}
              variant="outline"
              className="mt-3 w-full"
            >
              Sair
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function uniqueDocs(docs: LegalDocId[]): LegalDocId[] {
  return [...new Set(docs)];
}
