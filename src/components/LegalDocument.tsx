import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  legalCheckboxLabel,
  legalEndpoint,
  legalTitle,
  type LegalDocId,
} from '../legal/versions';

type LegalDocumentProps = {
  doc: LegalDocId;
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  onLoadedChange: (loaded: boolean) => void;
  enabled?: boolean;
};

export function LegalDocument({
  doc,
  accepted,
  onAcceptedChange,
  onLoadedChange,
  enabled = true,
}: LegalDocumentProps) {
  const { api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');
  const onLoadedRef = useRef(onLoadedChange);
  const onAcceptedRef = useRef(onAcceptedChange);
  onLoadedRef.current = onLoadedChange;
  onAcceptedRef.current = onAcceptedChange;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    onLoadedRef.current(false);
    try {
      const text = await api.fetchLegal(doc);
      setMarkdown(text);
      onLoadedRef.current(text.trim().length > 0);
    } catch (cause) {
      const message =
        cause instanceof ApiError
          ? cause.message
          : `Nao foi possivel carregar ${legalTitle(doc)}`;
      setMarkdown('');
      setError(message);
      onLoadedRef.current(false);
      onAcceptedRef.current(false);
    } finally {
      setLoading(false);
    }
  }, [api, doc]);

  useEffect(() => {
    void load();
  }, [load]);

  const canAccept = enabled && !loading && markdown.trim().length > 0;
  const checkboxId = `${doc}-accept-checkbox`;

  return (
    <section
      data-testid={`${doc}DocumentPanel`}
      className="mb-3 rounded-[18px] border-[3px] border-ink bg-paper p-3.5 shadow-[4px_4px_0_#111]"
    >
      <h3 className="font-display text-lg font-bold text-ink">{legalTitle(doc)}</h3>
      <p
        data-testid={`${doc}DocumentEndpoint`}
        className="mt-1 text-xs font-bold text-ink"
      >
        {legalEndpoint(doc)}
      </p>
      <div className="mt-2.5 max-h-[180px] min-h-24 overflow-auto rounded-xl border-2 border-ink bg-cream">
        {loading ? (
          <p className="p-4 text-sm text-muted" role="status" aria-live="polite">
            Carregando documento...
          </p>
        ) : error ? (
          <div className="p-3">
            <p className="text-sm text-ink">
              Nao foi possivel carregar o documento. Sem o texto vigente nao e
              possivel aceitar.
            </p>
            <p className="mt-2 text-xs text-ink">{error}</p>
            <button
              type="button"
              className="mt-2 rounded-xl border-[3px] border-ink bg-paper px-3 py-1.5 text-sm font-extrabold"
              onClick={() => void load()}
              disabled={!enabled}
            >
              Tentar de novo
            </button>
          </div>
        ) : (
          <pre
            data-testid={`${doc}DocumentText`}
            className="m-0 whitespace-pre-wrap p-3 font-body text-sm leading-[1.45] text-ink"
          >
            {markdown}
          </pre>
        )}
      </div>
      <div className="mt-1 flex items-start gap-2">
        <input
          id={checkboxId}
          data-testid={`${doc}AcceptCheckbox`}
          type="checkbox"
          className="mt-3 h-5 w-5 accent-green disabled:cursor-not-allowed"
          checked={accepted}
          disabled={!canAccept}
          aria-disabled={!canAccept}
          onChange={(event) => onAcceptedChange(event.target.checked)}
        />
        <label htmlFor={checkboxId} className="pt-3 text-sm text-ink">
          {legalCheckboxLabel(doc)}
        </label>
      </div>
    </section>
  );
}
