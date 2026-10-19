import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { isSafeAppPath, resetReturnToMemory } from '../auth/returnTo';
import { resetBillingReturnMemory } from '../billing/BillingReturn';

const navLog: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
  plan: 'free',
  subscription_status: 'none',
};

function createFetch() {
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

function Probe() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = `${location.pathname}${location.search}`;
  if (navLog[navLog.length - 1] !== current) {
    navLog.push(current);
  }
  return (
    <>
      <div data-testid="location-full">{current}</div>
      <button type="button" data-testid="go-entrar" onClick={() => navigate('/entrar')}>
        entrar
      </button>
      <button type="button" data-testid="go-root" onClick={() => navigate('/')}>
        root
      </button>
    </>
  );
}

function renderAt(path: string, fetchImpl = createFetch()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <Probe />
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await waitFor(() => {
    expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument();
  });
}

describe('rotas publicas e app', () => {
  beforeEach(() => {
    navLog.length = 0;
    resetReturnToMemory();
    resetBillingReturnMemory();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    resetReturnToMemory();
    resetBillingReturnMemory();
  });

  it('so aceita retorno interno do app', () => {
    expect(isSafeAppPath('/app')).toBe(true);
    expect(isSafeAppPath('/app/perfil')).toBe(true);
    expect(isSafeAppPath('/app/historico?x=1')).toBe(true);
    expect(isSafeAppPath('/entrar')).toBe(false);
    expect(isSafeAppPath('//evil.example')).toBe(false);
    expect(isSafeAppPath('/app/../../entrar')).toBe(false);
    expect(isSafeAppPath('https://evil.example/app')).toBe(false);
  });

  it('a landing nao usa o shell e os CTAs preservam a intencao', async () => {
    const fetchImpl = createFetch();
    const user = userEvent.setup();
    renderAt('/', fetchImpl);

    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expect(screen.queryByTestId('app-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-bottom-nav')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Análise de vaga com o seu currículo',
    );
    expect(screen.getByText(/5 análises por mês/)).toBeInTheDocument();
    expect(screen.getByText(/30 análises por mês/)).toBeInTheDocument();
    expect(screen.getByText('R$19,90/mês')).toBeInTheDocument();

    await user.click(screen.getByTestId('cta-comecar-gratis'));
    expect(screen.getByTestId('location-full')).toHaveTextContent('/entrar?tab=signup');
    expect(screen.getByTestId('auth-tab-signup')).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByTestId('go-root'));
    await user.click(screen.getByTestId('cta-assinar-essencial'));
    expect(screen.getByTestId('location-full').textContent).toContain('/entrar');
    expect(screen.getByTestId('location-full').textContent).toContain('next=');
    expect(decodeURIComponent(screen.getByTestId('location-full').textContent ?? '')).toContain(
      '/app/perfil',
    );
    expect(
      fetchImpl.mock.calls.some(([input]) => String(input).includes('/billing/checkout')),
    ).toBe(false);

    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('profile-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-full').textContent).toContain('/app/perfil');
  });

  it('sem JWT /app/curriculo volta a origem depois do login', async () => {
    const fetchImpl = createFetch();
    const user = userEvent.setup();
    renderAt('/app/curriculo', fetchImpl);
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.getByTestId('location-full').textContent).toContain('/entrar');
    expect(screen.queryByTestId('curriculo-page')).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some(([input]) => String(input).includes('/users/me/status')),
    ).toBe(false);

    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('curriculo-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-full').textContent).toContain('/app/curriculo');
  });

  it('sem JWT /app/historico volta a origem depois do login', async () => {
    const fetchImpl = createFetch();
    const user = userEvent.setup();
    renderAt('/app/historico', fetchImpl);
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.getByTestId('location-full').textContent).toContain('/entrar');
    expect(screen.queryByTestId('history-panel')).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some(([input]) => String(input).includes('/gap-history')),
    ).toBe(false);

    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('history-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-full').textContent).toContain('/app/historico');
  });

  it('rotas antigas redirecionam para /app e voltam depois do login', async () => {
    const user = userEvent.setup();
    renderAt('/historico');
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.getByTestId('location-full').textContent).toContain('/entrar');
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('location-full').textContent).toContain('/app/historico');
    });

    cleanup();
    resetReturnToMemory();
    const userPerfil = userEvent.setup();
    renderAt('/perfil');
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.getByTestId('location-full').textContent).toContain('/entrar');
    await login(userPerfil);
    await waitFor(() => {
      expect(screen.getByTestId('profile-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-full').textContent).toContain('/app/perfil');
  });

  it('logado em / ve a landing com Ir para o app; /entrar vai para /app', async () => {
    const user = userEvent.setup();
    renderAt('/entrar');
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('home-shell')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-full').textContent).toBe('/app');

    await user.click(screen.getByTestId('go-entrar'));
    await waitFor(() => {
      expect(screen.getByTestId('home-shell')).toBeInTheDocument();
    });
    expect(screen.getByTestId('location-full').textContent).toBe('/app');

    await user.click(screen.getByTestId('go-root'));
    expect(screen.getByTestId('landing-page')).toBeInTheDocument();
    expect(screen.getByTestId('cta-ir-para-o-app')).toBeInTheDocument();
    await user.click(screen.getByTestId('cta-ir-para-o-app'));
    await waitFor(() => {
      expect(screen.getByTestId('home-shell')).toBeInTheDocument();
    });
  });

  it('/?billing=success encaminha para /app e cai no login sem session_id', async () => {
    window.history.replaceState(null, '', '/?billing=success&session_id=cs_test_secret');
    renderAt('/?billing=success&session_id=cs_test_secret');

    expect(await screen.findByTestId('billing-login-notice')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location-full').textContent).toBe('/entrar');
    });
    expect(navLog.some((entry) => entry.startsWith('/app') && entry.includes('billing=success'))).toBe(
      true,
    );
    expect(screen.getByTestId('location-full').textContent).not.toContain('session_id');
    expect(screen.getByTestId('location-full').textContent).not.toContain('cs_test');
    expect(window.location.href).not.toContain('cs_test_secret');
  });
});
