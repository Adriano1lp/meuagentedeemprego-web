import { searchWithoutBillingReturn } from '../api/billing';

/** Destino padrão depois do login, quando não há rota de origem. */
export const APP_HOME = '/app';
export const APP_HISTORY = '/app/historico';
export const APP_CURRICULUM = '/app/curriculo';
export const APP_PROFILE = '/app/perfil';
export const ENTER_PATH = '/entrar';

/** Aviso neutro quando o refresh responde 401. Não carrega token nem URL da API. */
export const SESSION_EXPIRED_NOTICE = 'Sua sessão expirou. Entre de novo.';
export const SESSION_NOTICE_PARAM = 'aviso';
export const SESSION_NOTICE_VALUE = 'sessao';

/**
 * Rota de retorno depois do login. Só memória de módulo: some no reload,
 * junto com o JWT. Nunca guarda token nem session_id.
 */
let memoryReturn: string | null = null;

/** Controle ASCII, DEL e qualquer espaço (inclusive tab e quebra de linha). */
function hasControlOrWhitespace(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value) || /\s/.test(value);
}

function structurallySafe(value: string): boolean {
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
  if (hasControlOrWhitespace(path)) {
    return false;
  }
  return true;
}

/**
 * Só aceita caminhos internos do app. Recusa protocolo, host, `//`,
 * caractere de controle e espaço em branco — também depois de um
 * `decodeURIComponent`, antes de o parser de URL normalizar o texto.
 */
export function isSafeAppPath(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    return false;
  }
  if (hasControlOrWhitespace(value)) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (hasControlOrWhitespace(decoded)) {
    return false;
  }
  if (!structurallySafe(value)) {
    return false;
  }
  if (decoded !== value && !structurallySafe(decoded)) {
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

/**
 * Login depois de um refresh 401. `next` só entra se for caminho interno
 * `/app` ou `/app/*` (a mesma validação anti open-redirect).
 */
export function buildExpiredLoginPath(path: string): string {
  const params = new URLSearchParams();
  if (isSafeAppPath(path)) {
    params.set('next', path);
  }
  params.set(SESSION_NOTICE_PARAM, SESSION_NOTICE_VALUE);
  return `${ENTER_PATH}?${params.toString()}`;
}

export function isSessionExpiredNotice(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get(SESSION_NOTICE_PARAM) === SESSION_NOTICE_VALUE;
}
