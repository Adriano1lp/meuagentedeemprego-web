import { searchWithoutBillingReturn } from '../api/billing';

/** Destino padrão depois do login, quando não há rota de origem. */
export const APP_HOME = '/app';
export const APP_HISTORY = '/app/historico';
export const APP_CURRICULUM = '/app/curriculo';
export const APP_PROFILE = '/app/perfil';
export const ENTER_PATH = '/entrar';

/**
 * Rota de retorno depois do login. Só memória de módulo: some no reload,
 * junto com o JWT. Nunca guarda token nem session_id.
 */
let memoryReturn: string | null = null;

/** Só aceita caminhos internos do app. Recusa protocolo, host e `//`. */
export function isSafeAppPath(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    return false;
  }
  if (!value.startsWith('/app')) {
    return false;
  }
  if (value.includes('\\') || value.includes('://') || value.includes('@')) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value, 'https://mae.local');
  } catch {
    return false;
  }
  if (url.origin !== 'https://mae.local' || url.username || url.password) {
    return false;
  }
  const path = url.pathname;
  if (path !== APP_HOME && !path.startsWith(`${APP_HOME}/`)) {
    return false;
  }
  if (path.includes('//')) {
    return false;
  }
  return true;
}

export function rememberReturnTo(path: string): void {
  if (isSafeAppPath(path)) {
    memoryReturn = path;
  }
}

export function forgetReturnTo(): void {
  memoryReturn = null;
}

export function consumeReturnTo(fallback = APP_HOME): string {
  const next = memoryReturn && isSafeAppPath(memoryReturn) ? memoryReturn : fallback;
  memoryReturn = null;
  return next;
}

/** Só para testes. A sessão real perde isto no reload. */
export function resetReturnToMemory(): void {
  memoryReturn = null;
}

/** Path + query sem billing/session_id. session_id não é copiado. */
export function returnPathFromLocation(pathname: string, search: string): string {
  const cleaned = searchWithoutBillingReturn(search);
  const candidate = `${pathname}${cleaned}`;
  return isSafeAppPath(candidate) ? candidate : APP_HOME;
}
