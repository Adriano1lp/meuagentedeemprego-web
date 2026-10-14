import { useState } from 'react';

import { ApiError } from '../api/client';
import { PRIVACY_LOAD_FAILED } from '../api/profile';
import { useAuth } from '../auth/AuthContext';
import { LegalDoc, legalTitle } from '../legal/versions';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';

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
    <Card aria-labelledby="profile-privacy-title" className="mt-6">
      <CardHeader>
        <CardTitle id="profile-privacy-title" className="text-xl">
          Privacidade e LGPD
        </CardTitle>
        <CardDescription className="text-foreground">
          A politica de privacidade vigente e a mesma do cadastro.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <Button
          type="button"
          data-testid="profile-privacy-link"
          aria-expanded={open}
          aria-controls="profile-privacy-panel"
          onClick={() => void openPrivacy()}
          variant="secondary"
        >
          {legalTitle(LegalDoc.privacy)}
        </Button>

        {open ? (
          <div id="profile-privacy-panel" className="mt-4">
            {loading ? (
              <p
                data-testid="profile-privacy-loading"
                role="status"
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                Carregando politica de privacidade...
              </p>
            ) : null}
            {error ? (
              <Alert data-testid="profile-privacy-error" variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {markdown.trim() ? (
              <pre
                data-testid="profile-privacy-text"
                className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 font-sans text-sm leading-relaxed text-foreground"
              >
                {markdown}
              </pre>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
