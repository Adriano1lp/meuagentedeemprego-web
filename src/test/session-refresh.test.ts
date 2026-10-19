import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client';
import {
  cookieSessionInit,
  CSRF_HEADER,
  isApiOriginRequest,
  requestLogout,
  requestRefresh,
} from '../api/sessionHttp';
import { createMemoryTokenStore } from '../api/token';
import {
  createSessionCoordinator,
  REFRESH_LOCK_NAME,
  type SessionCoordinator,
} from '../auth/sessionRefresh';
import {
  buildExpiredLoginPath,
  isSafeAppPath,
  SESSION_EXPIRED_NOTICE,
} from '../auth/returnTo';

type Wire = { v: 1; type: string; accessToken?: string; id?: string; at?: number };

function createBus() {
  const handlers = new Set<(data: Wire) => void>();
  return {
    channel() {
      const mine = new Set<(data: Wire) => void>();
      return {
        postMessage(data: Wire) {
          for (const handler of handlers) {
            if (!mine.has(handler)) {
              handler(data);
            }
          }
        },
        addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
          const handler = (data: Wire) => listener({ data } as MessageEvent);
          mine.add(handler);
          handlers.add(handler);
        },
        removeEventListener() {},
        close() {
          for (const handler of mine) {
            handlers.delete(handler);
          }
        },
      };
    },
  };
}

function sharedLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const names: string[] = [];
  return {
    names,
    request(name: string, callback: () => Promise<unknown>) {
      names.push(name);
      const run = tail.then(() => callback());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function grantResponse(token: string, expiresIn = 600): Response {
  return new Response(
    JSON.stringify({ access_token: token, token_type: 'bearer', expires_in: expiresIn }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('opt-in da sessão e origem', () => {
  it('credentials e CSRF só na origem da API', () => {
    expect(isApiOriginRequest('https://api.example.test/auth/login', 'https://api.example.test')).toBe(
      true,
    );
    expect(isApiOriginRequest('https://evil.example/auth/login', 'https://api.example.test')).toBe(
      false,
    );
    expect(isApiOriginRequest('/__mae_api/auth/refresh', '/__mae_api')).toBe(true);
    expect(cookieSessionInit('https://evil.example/auth/login', 'https://api.example.test')).toBeNull();
    expect(cookieSessionInit('https://api.example.test/auth/refresh', 'https://api.example.test')).toEqual({
      credentials: 'include',
      csrf: '1',
    });
  });

  it('login e register optam por session cookie, com CSRF e credentials, sem X-MAE-Client', async () => {
    const store = createMemoryTokenStore();
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      const url = String(input);
      if (
        url.endsWith('/auth/login') ||
        url.endsWith('/auth/register') ||
        url.endsWith('/auth/refresh')
      ) {
        return grantResponse('jwt-opt-in', 120);
      }
      if (url.endsWith('/auth/me')) {
        return new Response(JSON.stringify({ display_name: 'Ada' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => store.get(),
    });

    await api.login({ email: 'ada@example.com', password: 'senha-segura' });
    await api.register({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'senha-segura',
      termsAccepted: true,
      privacyAccepted: true,
    });
    await requestLogout('https://api.example.test', fetchImpl);
    await requestRefresh('https://api.example.test', fetchImpl);

    const login = seen.find((call) => call.url.endsWith('/auth/login'));
    const register = seen.find((call) => call.url.endsWith('/auth/register'));
    const logout = seen.find((call) => call.url.endsWith('/auth/logout'));
    const refresh = seen.find((call) => call.url.endsWith('/auth/refresh'));

    expect(JSON.parse(String(login?.init?.body))).toMatchObject({
      email: 'ada@example.com',
      password: 'senha-segura',
      session: 'cookie',
    });
    expect(JSON.parse(String(register?.init?.body))).toMatchObject({
      display_name: 'Ada',
      session: 'cookie',
    });
    for (const call of [login, register, logout, refresh]) {
      expect(call?.init?.credentials).toBe('include');
      const headers = new Headers(call?.init?.headers);
      expect(headers.get(CSRF_HEADER)).toBe('1');
      expect(headers.get('X-MAE-Client')).toBeNull();
      expect(headers.get('X-User-Id')).toBeNull();
    }

    store.set('jwt-opt-in');
    await api.me();
    const me = seen.find((call) => call.url.endsWith('/auth/me'));
    expect(me?.init?.credentials).toBe('omit');
    const meHeaders = new Headers(me?.init?.headers);
    expect(meHeaders.get('Authorization')).toBe('Bearer jwt-opt-in');
    expect(meHeaders.get(CSRF_HEADER)).toBeNull();
    expect(meHeaders.get('X-User-Id')).toBeNull();

    expect(localSet).not.toHaveBeenCalled();
    const logged = [consoleLog, consoleInfo, consoleDebug, consoleWarn]
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((part) => String(part))
      .join('\n');
    expect(logged).not.toContain('jwt-opt-in');
    localSet.mockRestore();
    consoleLog.mockRestore();
    consoleInfo.mockRestore();
    consoleDebug.mockRestore();
    consoleWarn.mockRestore();
  });

  it('o access não entra em localStorage nem sessionStorage', async () => {
    const localSet = vi.spyOn(window.localStorage, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/refresh')) {
        return grantResponse('jwt-so-memoria');
      }
      return new Response('{}', { status: 404 });
    });
    const grant = await requestRefresh('https://api.example.test', fetchImpl);
    expect(grant.accessToken).toBe('jwt-so-memoria');
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('access_token')).toBeNull();
    expect(window.sessionStorage.getItem('access_token')).toBeNull();
    localSet.mockRestore();
    sessionSet.mockRestore();
  });
});

describe('single-flight do refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('N chamadas concorrentes na mesma aba geram 1 refresh', async () => {
    let posts = 0;
    const coordinator = createSessionCoordinator({
      locks: null,
      createChannel: () => null,
      drain: async () => {},
      postRefresh: async () => {
        posts += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { accessToken: 'jwt-unico', expiresIn: 90 };
      },
    });

    const results = await Promise.all([
      coordinator.refresh(),
      coordinator.refresh(),
      coordinator.refresh(),
      coordinator.refresh(),
      coordinator.refresh(),
    ]);

    expect(posts).toBe(1);
    expect(results.map((item) => item.accessToken)).toEqual([
      'jwt-unico',
      'jwt-unico',
      'jwt-unico',
      'jwt-unico',
      'jwt-unico',
    ]);
  });

  it('duas abas compartilham um único POST e reaproveitam o access', async () => {
    const bus = createBus();
    const locks = sharedLocks();
    let posts = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    function makeTab(): SessionCoordinator {
      return createSessionCoordinator({
        locks: locks as unknown as LockManager,
        createChannel: () => bus.channel(),
        drain: async () => {},
        postRefresh: async () => {
          posts += 1;
          if (posts === 1) {
            await gate;
          }
          return { accessToken: 'jwt-compartilhado', expiresIn: 300 };
        },
      });
    }

    const tabA = makeTab();
    const tabB = makeTab();
    const pending = Promise.all([tabA.refresh(), tabB.refresh()]);
    await vi.waitFor(() => {
      expect(posts).toBe(1);
    });
    release();
    const [fromA, fromB] = await pending;
    expect(posts).toBe(1);
    expect(fromA.accessToken).toBe('jwt-compartilhado');
    expect(fromB.accessToken).toBe('jwt-compartilhado');
    expect(locks.names.every((name) => name === REFRESH_LOCK_NAME)).toBe(true);
  });
});

describe('retry único no 401', () => {
  it('repete a chamada uma vez depois do refresh e não manda o token ao storage', async () => {
    const store = createMemoryTokenStore('jwt-velho');
    const localSet = vi.spyOn(window.localStorage, 'setItem');
    const sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
    let statusHits = 0;
    let refreshHits = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshHits += 1;
        return grantResponse('jwt-novo');
      }
      if (url.endsWith('/users/me/status')) {
        statusHits += 1;
        if (statusHits === 1) {
          return new Response(JSON.stringify({ detail: 'Token expirado' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt-novo');
        expect(init?.credentials).toBe('omit');
        return new Response(JSON.stringify({ user_id: 'user-1', has_cv: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => store.get(),
      refreshSession: async () => {
        const grant = await requestRefresh('https://api.example.test', fetchImpl);
        store.set(grant.accessToken);
        return true;
      },
    });

    const status = await api.getStatus();
    expect(status.has_cv).toBe(true);
    expect(statusHits).toBe(2);
    expect(refreshHits).toBe(1);
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    localSet.mockRestore();
    sessionSet.mockRestore();
  });

  it('se o refresh falha, não repete a chamada e sinaliza sessão expirada', async () => {
    const store = createMemoryTokenStore('jwt-velho');
    let statusHits = 0;
    let refreshHits = 0;
    let expired = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshHits += 1;
        return new Response(JSON.stringify({ detail: 'Sessao invalida' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/users/me/status')) {
        statusHits += 1;
        return new Response(JSON.stringify({ detail: 'https://api.example.test/auth token jwt-velho' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => store.get(),
      refreshSession: async () => {
        await requestRefresh('https://api.example.test', fetchImpl);
        return true;
      },
      onSessionExpired: () => {
        expired += 1;
      },
    });

    await expect(api.getStatus()).rejects.toMatchObject({ status: 401 });
    expect(statusHits).toBe(1);
    expect(refreshHits).toBe(1);
    expect(expired).toBe(1);
  });

  it('recusa next externo no caminho de retorno', () => {
    expect(isSafeAppPath('/app/perfil')).toBe(true);
    expect(buildExpiredLoginPath('/app/perfil')).toBe(
      '/entrar?next=%2Fapp%2Fperfil&aviso=sessao',
    );
    expect(buildExpiredLoginPath('/app/curriculo?aba=1')).toContain('next=');
    expect(buildExpiredLoginPath('/app/curriculo?aba=1')).toContain('aviso=sessao');
    const external = buildExpiredLoginPath('https://evil.example/app');
    expect(external).not.toContain('evil');
    expect(external).not.toContain('next=');
    expect(buildExpiredLoginPath('//evil.example/app')).not.toContain('evil');
    expect(SESSION_EXPIRED_NOTICE).toBe('Sua sessão expirou. Entre de novo.');
  });
});
