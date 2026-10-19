import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { resetSessionRuntimeForTests } from '../auth/sessionRefresh';
import { resetReturnToMemory } from '../auth/returnTo';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
  plan: 'free',
  subscription_status: 'none',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="session-location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string, fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <LocationProbe />
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  resetReturnToMemory();
  resetSessionRuntimeForTests();
});

describe('boot da sessão', () => {
  it('mostra skeleton e não pisca a landing nem o entrar', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/refresh')) {
        return gate;
      }
      if (String(input).includes('/auth/me')) {
        return json(userBody);
      }
      return json({ detail: 'ausente' }, 404);
    });

    renderAt('/app/perfil', fetchImpl);
    expect(screen.getByTestId('session-boot')).toBeInTheDocument();
    expect(screen.getByText('Carregando')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument();

    release(
      json({
        access_token: 'jwt-boot',
        token_type: 'bearer',
        expires_in: 600,
      }),
    );

    expect(await screen.findByTestId('profile-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
  });

  it('recarregar em /app/perfil mantém a mesma rota', async () => {
    const refreshBodies: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshBodies.push(String(init?.credentials));
        const headers = new Headers(init?.headers);
        expect(headers.get('X-MAE-CSRF')).toBe('1');
        expect(headers.get('X-MAE-Client')).toBeNull();
        return json({
          access_token: 'jwt-reload',
          token_type: 'bearer',
          expires_in: 600,
        });
      }
      if (url.includes('/auth/me') || /\/users\/me($|\?)/.test(url)) {
        return json(userBody);
      }
      if (url.includes('/users/me/status')) {
        return json({ user_id: 'user-1', has_cv: true, has_embeddings: true, plan: 'free' });
      }
      if (url.includes('/billing/me')) {
        return json({
          plan: 'free',
          subscription_status: 'none',
          used: 0,
          limit: 5,
          remaining: 5,
          period: '2026-10',
        });
      }
      return json({ detail: 'ausente' }, 404);
    });

    renderAt('/app/perfil', fetchImpl);
    expect(await screen.findByTestId('profile-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument();

    cleanup();
    resetSessionRuntimeForTests();
    renderAt('/app/perfil', fetchImpl);
    expect(await screen.findByTestId('profile-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('session-expired-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
    expect(refreshBodies.length).toBeGreaterThanOrEqual(2);
    expect(refreshBodies.every((value) => value === 'include')).toBe(true);
  });

  it('refresh 401 em /app/curriculo vai para /entrar?next e volta depois do login', async () => {
    const user = userEvent.setup();
    const localSet = vi.spyOn(window.localStorage, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        return json({ detail: 'Sessao invalida' }, 401);
      }
      if (url.includes('/auth/login')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.session).toBe('cookie');
        expect(init?.credentials).toBe('include');
        return json({
          access_token: 'jwt-login',
          token_type: 'bearer',
          expires_in: 600,
          user: userBody,
        });
      }
      if (url.includes('/auth/me') || /\/users\/me($|\?)/.test(url)) {
        return json(userBody);
      }
      if (url.includes('/users/me/status')) {
        return json({
          user_id: 'user-1',
          has_cv: false,
          has_embeddings: false,
          plan: 'free',
        });
      }
      if (url.includes('/billing/me')) {
        return json({
          plan: 'free',
          subscription_status: 'none',
          used: 0,
          limit: 5,
          remaining: 5,
          period: '2026-10',
        });
      }
      return json({ detail: 'ausente' }, 404);
    });

    renderAt('/app/curriculo', fetchImpl);
    expect(await screen.findByTestId('session-expired-notice')).toHaveTextContent(
      'Sua sessão expirou. Entre de novo.',
    );
    expect(screen.getByTestId('session-location').textContent).toContain('/entrar');
    expect(decodeURIComponent(screen.getByTestId('session-location').textContent ?? '')).toContain(
      'next=/app/curriculo',
    );
    expect(screen.getByTestId('session-location').textContent).toContain('aviso=sessao');
    expect(screen.getByTestId('session-location').textContent).not.toContain('evil');
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('curriculo-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();

    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('curriculo-page')).toBeInTheDocument();
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    localSet.mockRestore();
    sessionSet.mockRestore();
  });

  it('401 durante o uso renova uma vez e, se a repetição falha, vai para /entrar?next', async () => {
    let profileHits = 0;
    let refreshHits = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshHits += 1;
        return json({
          access_token: refreshHits === 1 ? 'jwt-boot' : 'jwt-renovado',
          token_type: 'bearer',
          expires_in: 600,
        });
      }
      if (url.includes('/auth/me')) {
        return json(userBody);
      }
      if (url.includes('/users/me/status') || url.includes('/billing/me')) {
        return json({
          user_id: 'user-1',
          has_cv: true,
          has_embeddings: true,
          plan: 'free',
          subscription_status: 'none',
          used: 0,
          limit: 5,
          remaining: 5,
          period: '2026-10',
        });
      }
      if (/\/users\/me($|\?)/.test(url)) {
        profileHits += 1;
        return json({ detail: 'Token expirado' }, 401);
      }
      return json({ detail: 'ausente' }, 404);
    });

    renderAt('/app/perfil', fetchImpl);
    expect(await screen.findByTestId('session-expired-notice')).toHaveTextContent(
      'Sua sessão expirou. Entre de novo.',
    );
    await waitFor(() => {
      expect(profileHits).toBe(2);
    });
    expect(refreshHits).toBe(2);
    expect(decodeURIComponent(screen.getByTestId('session-location').textContent ?? '')).toContain(
      'next=/app/perfil',
    );
    expect(screen.queryByTestId('profile-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
  });
});
