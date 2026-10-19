import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOGOUT_TIMEOUT_MS } from '../api/sessionHttp';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { LOGGED_OUT_KEY } from '../auth/loggedOut';
import {
  FOLLOWER_GRANT_WAIT_MS,
  resetSessionRuntimeForTests,
  SESSION_CHANNEL_NAME,
} from '../auth/sessionRefresh';
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let forceFollower = false;

class FollowerChannel {
  static all = new Set<FollowerChannel>();

  listeners = new Set<(event: MessageEvent) => void>();

  name: string;

  constructor(name: string) {
    this.name = name;
    FollowerChannel.all.add(this);
  }

  postMessage(data: unknown) {
    const message = data as { type?: string };
    if (forceFollower && message?.type === 'claim') {
      for (const listener of this.listeners) {
        listener({ data: { v: 1, type: 'claim', id: '' } } as MessageEvent);
      }
    }
    for (const other of FollowerChannel.all) {
      if (other === this || other.name !== this.name) {
        continue;
      }
      for (const listener of other.listeners) {
        listener({ data } as MessageEvent);
      }
    }
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener() {}

  close() {
    FollowerChannel.all.delete(this);
  }
}

function hideNavigatorLocks(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    get: () => undefined,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(navigator, 'locks', descriptor);
      return;
    }
    Reflect.deleteProperty(navigator, 'locks');
  };
}

function installSessionChannel(options?: { grantAfterMs?: number; forceFollower?: boolean }) {
  forceFollower = options?.forceFollower === true;
  FollowerChannel.all.clear();
  let scheduled = false;
  const Original = FollowerChannel;
  class SchedulingChannel extends Original {
    postMessage(data: unknown) {
      const message = data as { type?: string };
      if (message?.type === 'claim' && options?.grantAfterMs != null && !scheduled) {
        scheduled = true;
        const delay = options.grantAfterMs;
        setTimeout(() => {
          const peer = new Original(SESSION_CHANNEL_NAME);
          peer.postMessage({
            v: 1,
            type: 'grant',
            accessToken: 'jwt-seguidora',
            expiresIn: null,
            at: Date.now(),
          });
        }, delay);
      }
      super.postMessage(data);
    }
  }
  vi.stubGlobal(
    'BroadcastChannel',
    options?.grantAfterMs == null ? FollowerChannel : SchedulingChannel,
  );
  const restoreLocks = hideNavigatorLocks();
  resetSessionRuntimeForTests();
  return restoreLocks;
}

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

  it('sem locks, o grant em 3s é reaproveitado e não há outro POST', async () => {
    vi.useFakeTimers();
    const restoreLocks = installSessionChannel({ grantAfterMs: 3_000, forceFollower: true });
    const localSet = vi.spyOn(window.localStorage, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    let refreshPosts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshPosts += 1;
        return json({ access_token: 'jwt-nao-usar', token_type: 'bearer', expires_in: 600 });
      }
      if (url.includes('/auth/me') || /\/users\/me($|\?)/.test(url)) {
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
      return json({ detail: 'ausente' }, 404);
    });

    renderAt('/app/perfil', fetchImpl);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('session-boot')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(screen.getByTestId('session-boot')).toBeInTheDocument();
    expect(refreshPosts).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('profile-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument();
    expect(refreshPosts).toBe(0);
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('access_token')).toBeNull();
    expect(window.sessionStorage.getItem('access_token')).toBeNull();
    localSet.mockRestore();
    sessionSet.mockRestore();
    restoreLocks();
  });

  it('sem locks, sem grant em 5s vai para /entrar?next e não faz POST', async () => {
    vi.useFakeTimers();
    const restoreLocks = installSessionChannel({ forceFollower: true });
    let refreshPosts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshPosts += 1;
        return json({ access_token: 'jwt-nao-usar', token_type: 'bearer', expires_in: 600 });
      }
      return json({ detail: 'ausente' }, 404);
    });

    renderAt('/app/perfil', fetchImpl);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('session-boot')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLLOWER_GRANT_WAIT_MS - 1);
    });
    expect(screen.getByTestId('session-boot')).toBeInTheDocument();
    expect(screen.queryByTestId('session-expired-notice')).not.toBeInTheDocument();
    expect(refreshPosts).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('session-expired-notice')).toHaveTextContent(
      'Sua sessão expirou. Entre de novo.',
    );
    expect(screen.getByTestId('session-location').textContent).toContain('/entrar');
    expect(decodeURIComponent(screen.getByTestId('session-location').textContent ?? '')).toContain(
      'next=/app/perfil',
    );
    expect(screen.getByTestId('session-location').textContent).toContain('aviso=sessao');
    expect(screen.queryByTestId('profile-panel')).not.toBeInTheDocument();
    expect(refreshPosts).toBe(0);
    restoreLocks();
  });
});

describe('logout com timeout ou erro', () => {
  function authFetch(logout: 'hang' | 'error') {
    const signals: Array<AbortSignal | null> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        return json({ detail: 'sem sessao' }, 401);
      }
      if (url.includes('/auth/login')) {
        return json({
          access_token: 'jwt-logout',
          token_type: 'bearer',
          user: userBody,
        });
      }
      if (url.includes('/auth/logout')) {
        signals.push(init?.signal ?? null);
        if (logout === 'error') {
          throw new TypeError('Failed to fetch');
        }
        return new Promise<Response>((_resolve, reject) => {
          const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
          if (init?.signal?.aborted) {
            fail();
            return;
          }
          init?.signal?.addEventListener('abort', fail, { once: true });
        });
      }
      if (url.includes('/auth/me') || /\/users\/me($|\?)/.test(url)) {
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
      return json({ detail: 'ausente' }, 404);
    });
    return { fetchImpl, signals };
  }

  async function loginToApp(fetchImpl: typeof fetch) {
    const user = userEvent.setup();
    renderAt('/entrar', fetchImpl);
    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('logout-button')).toBeInTheDocument();
  }

  it('timeout do logout limpa a memória, avisa a outra aba e vai para /', async () => {
    const restoreLocks = installSessionChannel();
    const seen: Array<{ type?: string; accessToken?: string }> = [];
    const peer = new FollowerChannel(SESSION_CHANNEL_NAME);
    peer.addEventListener('message', (event) => {
      seen.push(event.data as { type?: string; accessToken?: string });
    });
    const localSet = vi.spyOn(window.localStorage, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    const { fetchImpl, signals } = authFetch('hang');
    await loginToApp(fetchImpl);

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId('logout-button'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS);
    });
    expect(screen.getByTestId('landing-page')).toBeInTheDocument();
    expect(screen.getByTestId('session-location').textContent).toBe('/');
    expect(screen.queryByTestId('home-shell')).not.toBeInTheDocument();
    expect(signals[0]?.aborted).toBe(true);
    expect(seen.some((message) => message.type === 'logout')).toBe(true);
    expect(seen.some((message) => message.accessToken)).toBe(false);
    expect(localSet.mock.calls).toEqual([['mae.loggedOut', '1']]);
    expect(window.localStorage.getItem('mae.loggedOut')).toBe('1');
    expect(window.localStorage.getItem('mae.loggedOut')).not.toMatch(/jwt|eyJ|token/i);
    expect(sessionSet).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('access_token')).toBeNull();
    localSet.mockRestore();
    sessionSet.mockRestore();
    restoreLocks();
  });

  it('erro no logout limpa a memória, avisa a outra aba e vai para /', async () => {
    const restoreLocks = installSessionChannel();
    const seen: Array<{ type?: string; accessToken?: string }> = [];
    const peer = new FollowerChannel(SESSION_CHANNEL_NAME);
    peer.addEventListener('message', (event) => {
      seen.push(event.data as { type?: string; accessToken?: string });
    });
    const localSet = vi.spyOn(window.localStorage, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    const { fetchImpl } = authFetch('error');
    await loginToApp(fetchImpl);

    fireEvent.click(screen.getByTestId('logout-button'));
    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expect(screen.getByTestId('session-location').textContent).toBe('/');
    expect(screen.queryByTestId('home-shell')).not.toBeInTheDocument();
    expect(seen.some((message) => message.type === 'logout')).toBe(true);
    expect(seen.some((message) => 'accessToken' in message && message.accessToken)).toBe(false);
    expect(localSet.mock.calls).toEqual([['mae.loggedOut', '1']]);
    expect(window.localStorage.getItem('mae.loggedOut')).toBe('1');
    expect(window.localStorage.getItem('mae.loggedOut')).not.toMatch(/jwt|eyJ|token/i);
    expect(sessionSet).not.toHaveBeenCalled();
    localSet.mockRestore();
    sessionSet.mockRestore();
    restoreLocks();
  });
});

describe('flag mae.loggedOut', () => {
  function sessionFetch(logout: 'throw' | 'ok' | 'count') {
    let refresh = 0;
    let logoutPosts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refresh += 1;
        return json({ access_token: 'jwt-nao', token_type: 'bearer', expires_in: 600 });
      }
      if (url.includes('/auth/logout')) {
        logoutPosts += 1;
        expect(init?.credentials).toBe('include');
        expect(new Headers(init?.headers).get('X-MAE-CSRF')).toBe('1');
        if (logout === 'throw') {
          throw new TypeError('Failed to fetch');
        }
        return new Response(null, { status: logoutPosts === 1 ? 204 : 401 });
      }
      if (url.includes('/auth/login')) {
        return json({
          access_token: 'jwt-login',
          token_type: 'bearer',
          expires_in: 600,
          user: userBody,
        });
      }
      if (url.includes('/auth/register')) {
        return json({
          access_token: 'jwt-signup',
          token_type: 'bearer',
          expires_in: 600,
          user: userBody,
        });
      }
      if (url.includes('/legal/terms')) {
        return new Response('Texto vigente de Termos de uso v1.0', {
          status: 200,
          headers: { 'Content-Type': 'text/markdown' },
        });
      }
      if (url.includes('/legal/privacy')) {
        return new Response('Texto vigente de Politica de privacidade v1.0', {
          status: 200,
          headers: { 'Content-Type': 'text/markdown' },
        });
      }
      if (url.includes('/auth/me') || /\/users\/me($|\?)/.test(url)) {
        return json(userBody);
      }
      if (url.includes('/users/me/status') || url.includes('/billing/me')) {
        return json({
          user_id: 'user-1',
          has_cv: false,
          has_embeddings: false,
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
    return {
      fetchImpl,
      refresh: () => refresh,
      logoutPosts: () => logoutPosts,
    };
  }

  async function loginOnForm() {
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));
    return user;
  }

  it('logout offline, reload sem refresh em /entrar, e online reenvia sem limpar a flag', async () => {
    const user = userEvent.setup();
    const first = sessionFetch('throw');
    renderAt('/entrar', first.fetchImpl);
    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('logout-button')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('logout-button'));
    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expect(first.logoutPosts()).toBe(1);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).not.toMatch(/jwt|eyJ|token/i);

    cleanup();
    resetReturnToMemory();
    resetSessionRuntimeForTests();
    const boot = sessionFetch('ok');
    renderAt('/app/perfil', boot.fetchImpl);
    expect(await screen.findByTestId('login-submit')).toBeInTheDocument();
    expect(screen.getByTestId('session-location').textContent).toContain('/entrar');
    expect(screen.queryByTestId('profile-panel')).not.toBeInTheDocument();
    expect(boot.refresh()).toBe(0);
    await waitFor(() => {
      expect(boot.logoutPosts()).toBe(1);
    });
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');

    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(boot.logoutPosts()).toBe(2);
    });
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).not.toMatch(/jwt|eyJ|token/i);

    await loginOnForm();
    expect(await screen.findByTestId('logout-button')).toBeInTheDocument();
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
  });

  it('login com erro mantém a flag', async () => {
    window.localStorage.setItem(LOGGED_OUT_KEY, '1');
    let loginHits = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/logout')) {
        return new Response(null, { status: 500 });
      }
      if (url.includes('/auth/refresh')) {
        return json({ access_token: 'jwt-nao', token_type: 'bearer', expires_in: 600 });
      }
      if (url.includes('/auth/login')) {
        loginHits += 1;
        return json({ detail: 'Senha invalida' }, 401);
      }
      return json({ detail: 'ausente' }, 404);
    });
    const user = userEvent.setup();
    renderAt('/entrar', fetchImpl);
    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-errada');
    await user.click(screen.getByTestId('login-submit'));
    await waitFor(() => {
      expect(loginHits).toBe(1);
    });
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
  });

  it('cadastro bem-sucedido limpa a flag', async () => {
    window.localStorage.setItem(LOGGED_OUT_KEY, '1');
    const boot = sessionFetch('ok');
    const user = userEvent.setup();
    renderAt('/entrar?tab=signup', boot.fetchImpl);
    await user.type(await screen.findByTestId('signup-name'), 'Ada Lovelace');
    await user.type(screen.getByTestId('signup-email'), 'ada@example.com');
    await user.type(screen.getByTestId('signup-password'), 'senha-segura');
    await waitFor(() => {
      expect(screen.getByTestId('termsDocumentText')).toHaveTextContent('Termos de uso');
      expect(screen.getByTestId('privacyDocumentText')).toHaveTextContent('privacidade');
    });
    await user.click(screen.getByTestId('termsAcceptCheckbox'));
    await user.click(screen.getByTestId('privacyAcceptCheckbox'));
    await waitFor(() => {
      expect(screen.getByTestId('createAccountButton')).toBeEnabled();
    });
    await user.click(screen.getByTestId('createAccountButton'));
    expect(await screen.findByTestId('logout-button')).toBeInTheDocument();
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
    expect(boot.refresh()).toBe(0);
  });

  it('outra aba com a flag sai e não chama /auth/refresh', async () => {
    const user = userEvent.setup();
    const boot = sessionFetch('ok');
    renderAt('/entrar', boot.fetchImpl);
    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('logout-button')).toBeInTheDocument();
    const refreshAfterLogin = boot.refresh();

    window.localStorage.setItem(LOGGED_OUT_KEY, '1');
    window.dispatchEvent(
      new StorageEvent('storage', { key: LOGGED_OUT_KEY, newValue: '1' }),
    );
    expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    expect(boot.refresh()).toBe(refreshAfterLogin);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    expect(screen.queryByTestId('logout-button')).not.toBeInTheDocument();
  });
});
