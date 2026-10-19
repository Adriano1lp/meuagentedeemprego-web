import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { GenericError } from '../components/GenericError';
import { supportMailto } from '../config/support';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
  plan: 'free',
  subscription_status: 'none',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFetch(statusCode = 200) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/login') || url.includes('/auth/register')) {
      return jsonResponse({
        access_token: 'jwt-login',
        token_type: 'bearer',
        user: userBody,
      });
    }
    if (url.includes('/auth/me') || /\/users\/me($|\?)/.test(url)) {
      return jsonResponse(userBody);
    }
    if (url.includes('/users/me/status')) {
      if (statusCode !== 200) {
        return jsonResponse({ detail: 'falha' }, statusCode);
      }
      return jsonResponse({
        user_id: 'user-1',
        has_cv: true,
        has_embeddings: true,
        plan: 'free',
        used: 1,
        limit: 5,
        remaining: 4,
        period: '2026-09',
      });
    }
    if (url.includes('/users/me/gap-history')) {
      return jsonResponse({ items: [], limit: 20, offset: 0 });
    }
    if (url.includes('/billing/me')) {
      return jsonResponse({
        plan: 'free',
        subscription_status: 'none',
        used: 1,
        limit: 5,
        remaining: 4,
        period: '2026-09',
      });
    }
    if (url.includes('/legal/')) {
      return new Response('# Documento', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'ausente' }, 404);
  });
}

function renderAt(path: string, fetchImpl = createFetch()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function expectSupportHref(name: string | RegExp) {
  const link = screen.getByRole('link', { name });
  expect(link.tagName).toBe('A');
  expect(link).toHaveAttribute('href', supportMailto());
  expect(link.getAttribute('href')).not.toContain('body=');
  expect(link.getAttribute('href')).not.toContain('ada@example.com');
  expect(link.getAttribute('href')).not.toContain('Ada');
  expect(link.className).toContain('focus-visible:ring-2');
  return link;
}

describe('links de suporte', () => {
  afterEach(() => {
    cleanup();
  });

  it('o erro genérico mostra tentar de novo e o mailto', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <GenericError
        message="Não foi possível carregar agora."
        onRetry={onRetry}
        retryTestId="generic-retry"
      />,
    );

    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expectSupportHref('Se continuar, fale com o suporte');
    await user.click(screen.getByTestId('generic-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('o rodapé da landing usa o mailto de suporte', async () => {
    renderAt('/');
    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expectSupportHref(/Suporte:/);
    expect(screen.getByTestId('support-link-landing').closest('footer')).toHaveAttribute(
      'data-testid',
      'landing-footer',
    );
  });

  it('entrar oferece falar com o suporte', async () => {
    const user = userEvent.setup();
    renderAt('/entrar');

    expect(await screen.findByTestId('auth-tab-login')).toBeInTheDocument();
    expectSupportHref('Problemas para entrar? Fale com o suporte');

    await user.click(screen.getByTestId('auth-tab-signup'));
    expectSupportHref('Problemas para entrar? Fale com o suporte');
  });

  it('logado, o menu e o perfil usam o mailto e o erro genérico também', async () => {
    const user = userEvent.setup();
    renderAt('/entrar', createFetch(500));

    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('home-status-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('home-status-error')).toHaveTextContent('Tentar de novo');
    expectSupportHref('Se continuar, fale com o suporte');

    const sidebarLink = screen.getByTestId('support-link-sidebar');
    expect(sidebarLink).toHaveTextContent('Ajuda e suporte');
    expect(sidebarLink).toHaveAttribute('href', supportMailto());
    expect(sidebarLink.closest('[data-testid="app-sidebar"]')).not.toBeNull();

    await user.click(screen.getByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-page')).toBeInTheDocument();
    });
    const profileLink = screen.getByTestId('support-link-profile');
    expect(profileLink).toHaveTextContent('Ajuda e suporte');
    expect(profileLink).toHaveAttribute('href', supportMailto());
    expect(profileLink.parentElement).toHaveClass('md:hidden');

    await user.click(screen.getByTestId('nav-curriculo'));
    await waitFor(() => {
      expect(screen.getByTestId('curriculo-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('curriculo-error')).toHaveTextContent('Tentar de novo');
    expect(screen.getByTestId('curriculo-error')).toHaveTextContent(
      'Se continuar, fale com o suporte',
    );
    expect(screen.getByTestId('support-link-error')).toHaveAttribute('href', supportMailto());
  });
});
