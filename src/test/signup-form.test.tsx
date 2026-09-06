import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { AuthPage } from '../pages/AuthPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function markdownResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/markdown' },
  });
}

describe('AuthPage signup', () => {
  it('nao pre-marca checkboxes e so habilita Criar conta apos os dois aceites', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/legal/terms')) {
        return markdownResponse('Texto vigente de Termos de uso v1.0');
      }
      if (url.includes('/legal/privacy')) {
        return markdownResponse('Texto vigente de Politica de privacidade v1.0');
      }
      return jsonResponse({ detail: 'not found' }, 404);
    });

    render(
      <MemoryRouter>
        <AuthProvider fetchImpl={fetchImpl}>
          <AuthPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('auth-tab-signup'));

    await waitFor(() => {
      expect(screen.getByTestId('termsDocumentText')).toHaveTextContent(
        'Texto vigente de Termos de uso v1.0',
      );
      expect(screen.getByTestId('privacyDocumentText')).toHaveTextContent(
        'Texto vigente de Politica de privacidade v1.0',
      );
    });

    const terms = screen.getByTestId('termsAcceptCheckbox') as HTMLInputElement;
    const privacy = screen.getByTestId(
      'privacyAcceptCheckbox',
    ) as HTMLInputElement;
    const submit = screen.getByTestId('createAccountButton');

    expect(terms.checked).toBe(false);
    expect(privacy.checked).toBe(false);
    expect(terms).not.toBeDisabled();
    expect(privacy).not.toBeDisabled();
    expect(submit).toBeDisabled();

    await user.click(terms);
    expect(submit).toBeDisabled();

    await user.click(privacy);
    expect(submit).toBeEnabled();
  });
});
