import { useState } from 'react';

import { ApiError } from '../api/client';
import { PRIVACY_LOAD_FAILED } from '../api/profile';
import { useAuth } from '../auth/AuthContext';
import { LegalDoc, legalTitle } from '../legal/versions';

export function PrivacyShortcut() {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');

  async function openPrivacy() {
    setOpen(true);
    if (markdown.trim() || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const text = await api.fetchLegal(LegalDoc.privacy);
      setMarkdown(text);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      setMarkdown('');
      setError(PRIVACY_LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-labelledby="profile-privacy-title"
      className="mt-6 rounded-3xl border-[3px] border-ink bg-paper p-6 shadow-[8px_8px_0_#111]"
    >
      <h2
        id="profile-privacy-title"
        className="font-display text-[22px] font-extrabold text-ink"
      >
        Privacidade e LGPD
      </h2>
      <p className="mt-3 text-sm leading-[1.45] text-ink">
        A politica de privacidade vigente e a mesma do cadastro.
      </p>
      <button
        type="button"
        data-testid="profile-privacy-link"
        aria-expanded={open}
        aria-controls="profile-privacy-panel"
        onClick={() => void openPrivacy()}
        className="mt-4 rounded-[18px] border-[3px] border-ink bg-sky px-4 py-2 font-display text-sm font-extrabold shadow-[4px_4px_0_#111]"
      >
        {legalTitle(LegalDoc.privacy)}
      </button>

      {open ? (
        <div id="profile-privacy-panel" className="mt-4">
          {loading ? (
            <p
              data-testid="profile-privacy-loading"
              role="status"
              aria-live="polite"
              className="text-sm text-ink"
            >
              Carregando politica de privacidade...
            </p>
          ) : null}
          {error ? (
            <p
              data-testid="profile-privacy-error"
              role="alert"
              className="text-sm text-ink"
            >
              {error}
            </p>
          ) : null}
          {markdown.trim() ? (
            <pre
              data-testid="profile-privacy-text"
              className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border-2 border-ink bg-cream p-3 font-body text-sm leading-[1.45] text-ink"
            >
              {markdown}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
