export const DEFAULT_API_BASE_URL =
  'https://meu-agente-de-emprego.onrender.com';

/** Prefixo do proxy Vite no `npm run dev` para evitar CORS no browser. */
export const DEV_API_PROXY_PREFIX = '/__mae_api';

export function configuredApiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
    /\/$/,
    '',
  );
}

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Em producao usa a URL absoluta (padrao: API live).
 * Em `vite dev`, se a URL for absoluta/remota, o browser passa pelo proxy
 * same-origin (`/__mae_api`) porque a API live nao libera CORS para localhost.
 */
export function resolveApiBaseUrl(
  configured: string,
  isDev: boolean,
): string {
  if (isDev && isAbsoluteHttpUrl(configured)) {
    return DEV_API_PROXY_PREFIX;
  }
  return configured;
}

export const API_BASE_URL = resolveApiBaseUrl(
  configuredApiBaseUrl(),
  import.meta.env.DEV,
);
