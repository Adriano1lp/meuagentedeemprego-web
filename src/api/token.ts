/**
 * W1: o access_token fica em memoria (React context / este store).
 * sessionStorage sobreviveria ao F5, mas qualquer XSS no origin leria o JWT;
 * por isso o minimo do W1 prefere memoria. Logout zera o token.
 * Nunca embutir segredos no bundle.
 */
export type TokenStore = {
  get: () => string | null;
  set: (token: string | null) => void;
  clear: () => void;
};

export function createMemoryTokenStore(initial: string | null = null): TokenStore {
  let token = initial;
  return {
    get: () => token,
    set: (value) => {
      token = value && value.trim() ? value : null;
    },
    clear: () => {
      token = null;
    },
  };
}

export function bearerHeaders(token: string | null): Record<string, string> {
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

export function extractAccessToken(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const token = (payload as { access_token?: unknown }).access_token;
  return typeof token === 'string' && token.trim() ? token : null;
}
