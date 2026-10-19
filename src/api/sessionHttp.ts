/**
 * HTTP da sessão web (PR #30 da API, master).
 * Opt-in só pelo body `session: "cookie"`. O header X-MAE-Client não entra:
 * o preflight dele responde 400.
 * credentials e X-MAE-CSRF só na origem da API, e só em login, register,
 * refresh e logout. O access token não é lido de cookie, storage ou log.
 */

export const CSRF_HEADER = 'X-MAE-CSRF';
export const CSRF_VALUE = '1';
export const COOKIE_SESSION = 'cookie';

export const AUTH_LOGIN_PATH = '/auth/login';
export const AUTH_REGISTER_PATH = '/auth/register';
export const AUTH_REFRESH_PATH = '/auth/refresh';
export const AUTH_LOGOUT_PATH = '/auth/logout';

/** A aba não espera o logout além disto. Timeout ou erro ainda descartam a sessão. */
export const LOGOUT_TIMEOUT_MS = 5_000;

const COOKIE_PATHS = new Set([
  AUTH_LOGIN_PATH,
  AUTH_REGISTER_PATH,
  AUTH_REFRESH_PATH,
  AUTH_LOGOUT_PATH,
]);

export class SessionExpiredError extends Error {
  readonly status = 401;

  constructor() {
    super('Sua sessão expirou. Entre de novo.');
    this.name = 'SessionExpiredError';
  }
}

export type AccessGrant = {
  accessToken: string;
  expiresIn: number | null;
};

export function isCookieSessionPath(path: string): boolean {
  return COOKIE_PATHS.has(path);
}

/** A base `/__mae_api` é o proxy same-origin do Vite para a API. */
export function isApiOriginRequest(requestUrl: string, apiBaseUrl: string): boolean {
  const base = apiBaseUrl.replace(/\/$/, '');
  if (!base) {
    return false;
  }
  try {
    if (base.startsWith('/')) {
      const parsed = new URL(requestUrl, 'https://mae.local');
      return parsed.pathname === base || parsed.pathname.startsWith(`${base}/`);
    }
    const request = new URL(requestUrl);
    const api = new URL(base);
    return request.origin === api.origin;
  } catch {
    return false;
  }
}

export function joinApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * credentials include + CSRF só se o pedido for para a origem da API.
 * Fora dela, devolve null e o chamador não envia cookie.
 */
export function cookieSessionInit(
  requestUrl: string,
  apiBaseUrl: string,
): { credentials: 'include'; csrf: string } | null {
  if (!isApiOriginRequest(requestUrl, apiBaseUrl)) {
    return null;
  }
  return { credentials: 'include', csrf: CSRF_VALUE };
}

function readExpiresIn(body: unknown): number | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const value = (body as { expires_in?: unknown }).expires_in;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function readAccessToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const token = (body as { access_token?: unknown }).access_token;
  return typeof token === 'string' && token.trim() ? token : null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function requestRefresh(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
): Promise<AccessGrant> {
  const url = joinApiUrl(apiBaseUrl, AUTH_REFRESH_PATH);
  const session = cookieSessionInit(url, apiBaseUrl);
  if (!session) {
    throw new SessionExpiredError();
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      credentials: session.credentials,
      headers: {
        Accept: 'application/json',
        [CSRF_HEADER]: session.csrf,
      },
    });
  } catch {
    throw new SessionExpiredError();
  }
  if (response.status === 401 || !response.ok) {
    throw new SessionExpiredError();
  }
  const body = await readJson(response);
  const accessToken = readAccessToken(body);
  if (!accessToken) {
    throw new SessionExpiredError();
  }
  return { accessToken, expiresIn: readExpiresIn(body) };
}

/** 204 idempotente. Timeout ou falha de rede não vazam detalhe; o chamador limpa a memória. */
export async function requestLogout(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const url = joinApiUrl(apiBaseUrl, AUTH_LOGOUT_PATH);
  const session = cookieSessionInit(url, apiBaseUrl);
  if (!session) {
    return;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fetchImpl(url, {
        method: 'POST',
        credentials: session.credentials,
        headers: {
          Accept: 'application/json',
          [CSRF_HEADER]: session.csrf,
        },
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, LOGOUT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Timeout ou sem rede: a sessão local ainda é descartada.
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
