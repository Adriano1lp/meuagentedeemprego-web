import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import {
  profileErrorLeaksInternals,
  PROFILE_LOAD_FAILED,
  PROFILE_SESSION_EXPIRED,
} from '../api/profile';
import { AuthProvider } from '../auth/AuthContext';

const authUser = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

const statusBody = {
  user_id: 'user-1',
  has_cv: true,
  has_embeddings: true,
  plan: 'free',
  used: 1,
  limit: 5,
  remaining: 4,
};

const currentUserBody = {
  user_id: 'user-1',
  auth_mode: 'jwt',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_accepted: true,
  terms_version: '1.0',
  privacy_accepted: true,
  privacy_version: '1.0',
  plan: 'essencial',
  subscription_status: 'active',
  used: 99,
  limit: 30,
  remaining: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isCurrentUserUrl(url: string): boolean {
  const path = new URL(url, 'http://local').pathname;
  return path.endsWith('/users/me');
}

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  profileCalls: string[];
  privacyCalls: string[];
};

function createHarness(options: {
  currentUser?: unknown | (() => Response);
  me?: () => Response;
  legal?: () => Response;
} = {}): Harness {
  const profileCalls: string[] = [];
  const privacyCalls: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (headers.get('X-User-Id') || headers.get('x-user-id')) {
      throw new Error('X-User-Id nao deve ser enviado');
    }
    const auth = headers.get('Authorization');
    if (auth === 'Bearer' || auth === 'Bearer ' || auth === 'Bearer null') {
      throw new Error('Bearer vazio');
    }

    if (url.includes('/auth/login')) {
      return jsonResponse({
        access_token: 'jwt-login',
        token_type: 'bearer',
        user: authUser,
      });
    }
    if (url.includes('/auth/me')) {
      return options.me?.() ?? jsonResponse(authUser);
    }
    if (url.includes('/users/me/status')) {
      return jsonResponse(statusBody);
    }
    if (isCurrentUserUrl(url)) {
      profileCalls.push(url);
      if (typeof options.currentUser === 'function') {
        return options.currentUser();
      }
      return jsonResponse(options.currentUser ?? currentUserBody);
    }
    if (url.includes('/legal/privacy')) {
      privacyCalls.push(url);
      return (
        options.legal?.() ??
        new Response(
          '# Politica de Privacidade\n\nTexto vigente de Politica de privacidade v1.0',
          { status: 200, headers: { 'Content-Type': 'text/markdown' } },
        )
      );
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });

  return { fetchImpl, profileCalls, privacyCalls };
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

function renderApp(fetchImpl: Harness['fetchImpl'], initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <LocationProbe />
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function expectTokenOnlyInMemory() {
  expect(window.localStorage.getItem('access_token')).toBeNull();
  expect(window.sessionStorage.getItem('access_token')).toBeNull();
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
}

describe('Feature: Perfil leve na web', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('render dos dados mockados da API — nome, email, plano e status', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('nav-perfil')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('Ada Lovelace');
    });

    expect(screen.getByTestId('profile-email')).toHaveTextContent('ada@example.com');
    expect(screen.getByTestId('profile-plan')).toHaveTextContent('Essencial');
    expect(screen.getByTestId('profile-status')).toHaveTextContent('Ativa');
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
    expect(screen.queryByText(/30/)).not.toBeInTheDocument();
    expect(screen.queryByText(/analises usadas/i)).not.toBeInTheDocument();
    expect(harness.profileCalls.length).toBeGreaterThan(0);
    expect(harness.privacyCalls).toEqual([]);
    expectTokenOnlyInMemory();
  });

  it('nao inventa plano quando GET /users/me omite plan e subscription_status', async () => {
    const harness = createHarness({
      currentUser: {
        user_id: 'user-1',
        display_name: 'Ada Lovelace',
        email: 'ada@example.com',
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await user.click(await screen.findByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('Ada Lovelace');
    });
    expect(screen.queryByTestId('profile-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-status')).not.toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem assinatura')).not.toBeInTheDocument();
  });

  it('payload sem identidade mostra estado vazio, sem Free nem cota', async () => {
    const harness = createHarness({
      currentUser: { user_id: 'user-1', auth_mode: 'jwt' },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await user.click(await screen.findByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-empty')).toHaveTextContent(
        'A conta nao trouxe nome, email ou plano.',
      );
    });
    expect(screen.queryByTestId('profile-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('logout limpa a sessao em memoria e volta ao login', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await user.click(await screen.findByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-logout')).toBeInTheDocument();
    });
    expectTokenOnlyInMemory();

    const callsBeforeLogout = harness.fetchImpl.mock.calls.length;
    await user.click(screen.getByTestId('profile-logout'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-tab-login')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/');
    expect(screen.queryByTestId('profile-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-name')).not.toBeInTheDocument();
    expectTokenOnlyInMemory();
    expect(
      harness.fetchImpl.mock.calls.slice(callsBeforeLogout).some(([input]) =>
        isCurrentUserUrl(String(input)),
      ),
    ).toBe(false);
  });

  it('sem JWT redireciona ao login e nao chama GET /users/me', () => {
    const guest = createHarness({});
    renderApp(guest.fetchImpl, '/perfil');
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/');
    expect(screen.getByTestId('auth-tab-login')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-panel')).not.toBeInTheDocument();
    expect(guest.profileCalls).toEqual([]);
    expect(guest.privacyCalls).toEqual([]);
    expect(guest.fetchImpl).not.toHaveBeenCalled();
  });

  it('atalho de privacidade carrega GET /legal/privacy so depois do clique', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await user.click(await screen.findByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-privacy-link')).toBeInTheDocument();
    });
    expect(harness.privacyCalls).toEqual([]);
    expect(screen.queryByTestId('profile-privacy-text')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('profile-privacy-link'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-privacy-text')).toHaveTextContent(
        'Texto vigente de Politica de privacidade v1.0',
      );
    });
    expect(harness.privacyCalls.some((url) => url.includes('/legal/privacy'))).toBe(
      true,
    );
    expect(screen.getByTestId('profile-privacy-link')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.queryByTestId('privacyAcceptCheckbox')).not.toBeInTheDocument();
  });

  it('erro de perfil nao mostra path, URL ou token', async () => {
    const harness = createHarness({
      currentUser: () =>
        jsonResponse(
          {
            detail:
              'File "/app/main.py", line 12, in get_current_user GET /users/me Bearer jwt-abc',
            display_name: 'Outra Pessoa',
            email: 'outra@example.com',
          },
          500,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await user.click(await screen.findByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-error')).toHaveTextContent(
        PROFILE_LOAD_FAILED,
      );
    });
    const errorText = screen.getByTestId('profile-error').textContent ?? '';
    expect(errorText).not.toContain('/users/me');
    expect(errorText).not.toContain('onrender.com');
    expect(errorText).not.toContain('jwt-abc');
    expect(errorText).not.toContain('main.py');
    expect(errorText).not.toContain('Outra Pessoa');
    expect(profileErrorLeaksInternals(errorText)).toBe(false);
    expect(screen.queryByTestId('profile-name')).not.toBeInTheDocument();
  });

  it('401 no perfil pede novo login sem mostrar dados alheios', async () => {
    const harness = createHarness({
      currentUser: () =>
        jsonResponse(
          {
            detail: 'Nao autenticado',
            display_name: 'Outra Pessoa',
            email: 'outra@example.com',
          },
          401,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await user.click(await screen.findByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-error')).toHaveTextContent(
        PROFILE_SESSION_EXPIRED,
      );
    });
    expect(screen.queryByText('Outra Pessoa')).not.toBeInTheDocument();
    expect(screen.queryByText('outra@example.com')).not.toBeInTheDocument();
  });
});
