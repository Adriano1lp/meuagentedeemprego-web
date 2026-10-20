import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client';
import {
  cookieSessionInit,
  CSRF_HEADER,
  isApiOriginRequest,
  LOGOUT_TIMEOUT_MS,
  requestLogout,
  requestRefresh,
  SessionExpiredError,
} from '../api/sessionHttp';
import { createMemoryTokenStore } from '../api/token';
import {
  clearLoggedOutFlag,
  LOGGED_OUT_KEY,
  LOGOUT_RETRY_BASE_MS,
  LOGOUT_RETRY_MAX_MS,
  logoutRetryDelay,
  markLoggedOut,
  retryLoggedOut,
} from '../auth/loggedOut';
import {
  CLAIM_COLLISION_MS,
  CLAIM_CONFIRM_MS,
  createSessionCoordinator,
  FOLLOWER_GRANT_WAIT_MS,
  getSessionCoordinator,
  REFRESH_LOCK_NAME,
  setRefreshImplementation,
  type SessionCoordinator,
} from '../auth/sessionRefresh';
import {
  APP_HOME,
  buildExpiredLoginPath,
  isSafeAppPath,
  SESSION_EXPIRED_NOTICE,
} from '../auth/returnTo';

type Wire = { v: 1; type: string; accessToken?: string; id?: string; at?: number; from?: string };

function createBus(drop: (data: Wire) => boolean = () => false) {
  const handlers = new Set<(data: Wire) => void>();
  return {
    channel() {
      const mine = new Set<(data: Wire) => void>();
      return {
        postMessage(data: Wire) {
          if (drop(data)) {
            return;
          }
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

  it('rejeita open redirect no ?next e aceita /app/perfil', () => {
    const rejected = [
      '//evil.com',
      '/\\evil.com',
      '/\\\\evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      '%2F%2Fevil.com',
      '%5Cevil.com',
      '/@evil.com',
      'http:evil',
      '/app%0A//evil',
      '\t//evil',
    ];
    for (const next of rejected) {
      const decoded = new URLSearchParams(`next=${next}`).get('next');
      expect(decoded, next).toBeTruthy();
      expect(isSafeAppPath(decoded ?? ''), next).toBe(false);
      expect(isSafeAppPath(next), next).toBe(false);
      const destination = decoded && isSafeAppPath(decoded) ? decoded : APP_HOME;
      expect(destination, next).toBe(APP_HOME);
      expect(destination).not.toContain('evil');
      expect(destination).not.toContain('javascript');
    }
    expect(isSafeAppPath('/app/perfil')).toBe(true);
    expect(isSafeAppPath('/app\t/perfil')).toBe(false);
    expect(isSafeAppPath('/app\n//evil')).toBe(false);
    expect(new URLSearchParams('next=/app%0A//evil').get('next')).toBe('/app\n//evil');
    expect(isSafeAppPath(new URLSearchParams('next=/app%0A//evil').get('next') ?? '')).toBe(
      false,
    );
    expect(new URLSearchParams('next=/app/perfil').get('next')).toBe('/app/perfil');
  });
});

describe('seguidora sem navigator.locks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makePair(postRefresh: () => Promise<{ accessToken: string; expiresIn: number | null }>) {
    const bus = createBus();
    let posts = 0;
    const coordinators = [0, 1].map(() =>
      createSessionCoordinator({
        locks: null,
        createChannel: () => bus.channel(),
        drain: async () => {},
        postRefresh: async () => {
          posts += 1;
          return postRefresh();
        },
      }),
    );
    for (const tab of coordinators) {
      tab.subscribe(() => {});
    }
    return {
      coordinators,
      posts: () => posts,
    };
  }

  it('reaproveita o grant que chega em 3s e faz um único POST', async () => {
    vi.useFakeTimers();
    expect(FOLLOWER_GRANT_WAIT_MS).toBe(5_000);
    const pair = makePair(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return { accessToken: 'jwt-3s', expiresIn: 90 };
    });
    const pending = Promise.all(pair.coordinators.map((tab) => tab.refresh()));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(pair.posts()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const grants = await pending;
    expect(pair.posts()).toBe(1);
    expect(grants.map((grant) => grant.accessToken)).toEqual(['jwt-3s', 'jwt-3s']);
  });

  it('sem grant nem falha em 5s a seguidora falha fechado e não faz outro POST', async () => {
    vi.useFakeTimers();
    let releaseLeader: () => void = () => {};
    const pair = makePair(
      () =>
        new Promise((resolve) => {
          releaseLeader = () => resolve({ accessToken: 'jwt-lider', expiresIn: 30 });
        }),
    );
    const states: Array<'pending' | 'ok' | 'fail'> = ['pending', 'pending'];
    const errors: unknown[] = [];
    const tasks = pair.coordinators.map((tab, index) =>
      tab.refresh().then(
        () => {
          states[index] = 'ok';
        },
        (error: unknown) => {
          states[index] = 'fail';
          errors.push(error);
        },
      ),
    );

    await vi.advanceTimersByTimeAsync(FOLLOWER_GRANT_WAIT_MS - 1);
    expect(states).toEqual(['pending', 'pending']);
    expect(pair.posts()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(states.filter((state) => state === 'fail')).toHaveLength(1);
    expect(states.filter((state) => state === 'pending')).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SessionExpiredError);
    expect(pair.posts()).toBe(1);

    releaseLeader();
    await Promise.all(tasks);
    expect(pair.posts()).toBe(1);
    expect(states.filter((state) => state === 'ok')).toHaveLength(1);
  });

  it('a falha do líder chega pelo canal e a seguidora não repete o POST', async () => {
    vi.useFakeTimers();
    const pair = makePair(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      throw new SessionExpiredError();
    });
    const tasks = pair.coordinators.map((tab) =>
      tab.refresh().then(
        () => 'ok' as const,
        (error: unknown) => error,
      ),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    const results = await Promise.all(tasks);
    expect(pair.posts()).toBe(1);
    expect(results.every((result) => result instanceof SessionExpiredError)).toBe(true);
  });
});

describe('timeout do logout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborta o POST em 5s e mesmo assim resolve', async () => {
    vi.useFakeTimers();
    expect(LOGOUT_TIMEOUT_MS).toBe(5_000);
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const pending = requestLogout('https://api.example.test', fetchImpl);
    await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('erro de rede resolve para o chamador limpar a sessão', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(requestLogout('https://api.example.test', fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('flag de logout', () => {
  it('pula o refresh e o 401-retry sem gravar token', async () => {
    markLoggedOut();
    let posts = 0;
    setRefreshImplementation(async () => {
      posts += 1;
      return { accessToken: 'jwt-nao-gravar', expiresIn: 60 };
    });
    await expect(getSessionCoordinator().refresh()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(posts).toBe(0);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).not.toMatch(/jwt|eyJ|token/i);

    const store = createMemoryTokenStore('jwt-velho');
    let refreshHits = 0;
    let expired = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshHits += 1;
        return grantResponse('jwt-nao-gravar');
      }
      if (url.endsWith('/users/me/status')) {
        return new Response(JSON.stringify({ detail: 'expirado' }), {
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
        await getSessionCoordinator().refresh();
        return true;
      },
      onSessionExpired: () => {
        expired += 1;
      },
    });
    await expect(api.getStatus()).rejects.toMatchObject({ status: 401 });
    expect(refreshHits).toBe(0);
    expect(expired).toBe(1);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
  });

  it('reenvio concorrente faz um POST e 204, 401 ou 500 não apagam a flag', async () => {
    markLoggedOut();
    let posts = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      posts += 1;
      expect(init?.credentials).toBe('include');
      expect(new Headers(init?.headers).get(CSRF_HEADER)).toBe('1');
      await gate;
      return new Response(null, { status: 204 });
    });
    const pending = Promise.all([
      retryLoggedOut('https://api.example.test', fetchImpl),
      retryLoggedOut('https://api.example.test', fetchImpl),
    ]);
    await vi.waitFor(() => {
      expect(posts).toBe(1);
    });
    release();
    await pending;
    expect(posts).toBe(1);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');

    vi.useFakeTimers();
    for (const status of [401, 500]) {
      const again = vi.fn(async () => new Response(null, { status }));
      const pending = retryLoggedOut('https://api.example.test', again);
      await vi.advanceTimersByTimeAsync(LOGOUT_RETRY_MAX_MS);
      await pending;
      expect(again).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    }
    vi.useRealTimers();
  });

  it('login enquanto o reenvio espera não chama /auth/logout, com lock e sem', async () => {
    async function race(locks: LockManager | null) {
      const restore = installLocks(locks);
      try {
        markLoggedOut();
        const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
          expect(String(input)).toContain('/auth/logout');
          return new Response(null, { status: 204 });
        });
        const pending = retryLoggedOut('https://api.example.test', fetchImpl);
        expect(fetchImpl).not.toHaveBeenCalled();
        clearLoggedOutFlag();
        if (locks && 'release' in locks) {
          (locks as LockManager & { release: () => void }).release();
        }
        await pending;
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
      } finally {
        restore();
      }
    }

    const locks = gatingLocks();
    await race(locks as unknown as LockManager);
    await race(null);
  });
});

function installLocks(locks: LockManager | null): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    get: () => locks ?? undefined,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(navigator, 'locks', descriptor);
      return;
    }
    Reflect.deleteProperty(navigator, 'locks');
  };
}

function gatingLocks() {
  const queue: Array<() => void> = [];
  return {
    request(_name: string, callback: () => Promise<unknown> | unknown) {
      return new Promise<void>((resolve) => {
        queue.push(resolve);
      }).then(() => callback());
    },
    release() {
      queue.shift()?.();
    },
  };
}

function createDelayedBus(delayMs: number) {
  const handlers = new Set<(data: Wire) => void>();
  return {
    channel() {
      const mine = new Set<(data: Wire) => void>();
      return {
        postMessage(data: Wire) {
          setTimeout(() => {
            for (const handler of handlers) {
              if (!mine.has(handler)) {
                handler(data);
              }
            }
          }, delayMs);
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

describe('401 do refresh', () => {
  it('confirma só quando o POST responde 401', async () => {
    const fetch401 = vi.fn(async () => new Response(JSON.stringify({ detail: 'nao' }), { status: 401 }));
    await expect(requestRefresh('https://api.example.test', fetch401)).rejects.toMatchObject({
      confirmed: true,
    });
    const fetch500 = vi.fn(async () => new Response('no', { status: 500 }));
    await expect(requestRefresh('https://api.example.test', fetch500)).rejects.toMatchObject({
      confirmed: false,
    });
  });
});

describe('eleição sem navigator.locks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cinco rodadas com F5 simultâneo não revogam a família', async () => {
    vi.useFakeTimers();
    expect(CLAIM_CONFIRM_MS).toBeGreaterThan(0);
    for (let round = 0; round < 5; round += 1) {
      let used = false;
      let revoked = false;
      let posts = 0;
      const bus = createDelayedBus(40);
      const coordinators = [0, 1].map(() =>
        createSessionCoordinator({
          locks: null,
          createChannel: () => bus.channel(),
          drain: async () => {},
          postRefresh: async () => {
            if (revoked || used) {
              revoked = true;
              throw new SessionExpiredError(true);
            }
            posts += 1;
            used = true;
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { accessToken: `jwt-rodada-${round}`, expiresIn: 90 };
          },
        }),
      );
      for (const tab of coordinators) {
        tab.subscribe(() => {});
      }
      const pending = Promise.allSettled(coordinators.map((tab) => tab.refresh()));
      await vi.advanceTimersByTimeAsync(2_000);
      const results = await pending;
      expect(revoked, `rodada ${round + 1}`).toBe(false);
      expect(posts, `rodada ${round + 1}`).toBe(1);
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      if (results.every((result) => result.status === 'fulfilled')) {
        const tokens = results.map((result) =>
          result.status === 'fulfilled' ? result.value.accessToken : '',
        );
        expect(tokens).toEqual([`jwt-rodada-${round}`, `jwt-rodada-${round}`]);
      }
    }
  });

  it('uma aba que abre depois reaproveita o grant e não faz outro POST', async () => {
    vi.useFakeTimers();
    const bus = createBus();
    let posts = 0;
    let revoked = false;
    const postRefresh = async () => {
      if (posts > 0) {
        revoked = true;
        throw new SessionExpiredError(true);
      }
      posts += 1;
      return { accessToken: 'jwt-tarde', expiresIn: 90 };
    };
    const first = createSessionCoordinator({
      locks: null,
      createChannel: () => bus.channel(),
      drain: async () => {},
      postRefresh,
    });
    first.subscribe(() => {});
    const pending = first.refresh();
    await vi.advanceTimersByTimeAsync(CLAIM_CONFIRM_MS + CLAIM_COLLISION_MS + 20);
    const grant = await pending;
    expect(grant.accessToken).toBe('jwt-tarde');
    expect(posts).toBe(1);

    const second = createSessionCoordinator({
      locks: null,
      createChannel: () => bus.channel(),
      drain: async () => {},
      postRefresh,
    });
    second.subscribe(() => {});
    const shared = await second.refresh();
    expect(shared.accessToken).toBe('jwt-tarde');
    expect(posts).toBe(1);
    expect(revoked).toBe(false);
  });

  it('sem ack do claim as duas abas falham fechado e não há POST', async () => {
    vi.useFakeTimers();
    let posts = 0;
    let revoked = false;
    const bus = createBus((data) => data.type === 'claim-ack');
    const coordinators = [0, 1].map(() =>
      createSessionCoordinator({
        locks: null,
        createChannel: () => bus.channel(),
        drain: async () => {},
        postRefresh: async () => {
          if (posts > 0) {
            revoked = true;
            throw new SessionExpiredError(true);
          }
          posts += 1;
          return { accessToken: 'jwt-nao', expiresIn: 30 };
        },
      }),
    );
    for (const tab of coordinators) {
      tab.subscribe(() => {});
    }
    const pending = Promise.allSettled(coordinators.map((tab) => tab.refresh()));
    await vi.advanceTimersByTimeAsync(CLAIM_CONFIRM_MS + FOLLOWER_GRANT_WAIT_MS);
    const results = await pending;
    expect(posts).toBe(0);
    expect(revoked).toBe(false);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });
});

describe('backoff do reenvio de logout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dobra a espera até o teto e não agenda outro POST sozinho', async () => {
    expect(logoutRetryDelay(1)).toBe(LOGOUT_RETRY_BASE_MS);
    expect(logoutRetryDelay(2)).toBe(2_000);
    expect(logoutRetryDelay(3)).toBe(4_000);
    expect(logoutRetryDelay(6)).toBe(LOGOUT_RETRY_MAX_MS);
    expect(logoutRetryDelay(8)).toBe(LOGOUT_RETRY_MAX_MS);

    vi.useFakeTimers();
    markLoggedOut();
    let posts = 0;
    const fetchImpl = vi.fn(async () => {
      posts += 1;
      return new Response(null, { status: 500 });
    });

    await retryLoggedOut('https://api.example.test', fetchImpl);
    expect(posts).toBe(1);

    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const delay of delays) {
      const before = posts;
      const pending = retryLoggedOut('https://api.example.test', fetchImpl);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(posts).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(posts).toBe(before + 1);
    }
    await vi.advanceTimersByTimeAsync(LOGOUT_RETRY_MAX_MS);
    expect(posts).toBe(1 + delays.length);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).not.toMatch(/jwt|eyJ|token/i);
  });

  it('o Sair forçado não espera o intervalo e a flag continua', async () => {
    vi.useFakeTimers();
    markLoggedOut();
    const failing = vi.fn(async () => new Response(null, { status: 500 }));
    await retryLoggedOut('https://api.example.test', failing);
    expect(failing).toHaveBeenCalledTimes(1);

    const forced = vi.fn(async () => new Response(null, { status: 204 }));
    await retryLoggedOut('https://api.example.test', forced, true);
    expect(forced).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
  });

  it('pede o mesmo lock do refresh', async () => {
    markLoggedOut();
    const names: string[] = [];
    const restore = installLocks({
      request(name: string, callback: () => Promise<unknown> | unknown) {
        names.push(name);
        return Promise.resolve(callback());
      },
    } as unknown as LockManager);
    try {
      await retryLoggedOut(
        'https://api.example.test',
        async () => new Response(null, { status: 204 }),
      );
      expect(names).toEqual([REFRESH_LOCK_NAME]);
      expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe('1');
    } finally {
      restore();
    }
  });
});
