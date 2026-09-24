import type { DeleteAccountResult, UserDataExport } from './types';

type LgpdErrorLike = {
  status?: number;
  message?: string;
  outdated?: { message?: string } | null;
};

export const EXPORT_PATH = '/users/me/export';

/** Valor exato exigido por `_require_delete_confirmation` no backend. */
export const DELETE_ACCOUNT_CONFIRM = 'DELETE';

export const DELETE_ACCOUNT_BODY = {
  confirm: DELETE_ACCOUNT_CONFIRM,
} as const;

/**
 * A resposta 200 nao traz Content-Disposition. O arquivo e o JSON recebido,
 * gravado no cliente com este nome.
 */
export const EXPORT_DOWNLOAD_FILENAME = 'meus-dados.json';

export const EXPORT_LOGIN_REQUIRED =
  'Entre na sua conta para exportar seus dados.';
export const EXPORT_SESSION_EXPIRED =
  'Sessao expirada. Entre novamente para exportar seus dados.';
export const EXPORT_FAILED =
  'Nao foi possivel exportar seus dados. Tente novamente.';

export const DELETE_LOGIN_REQUIRED =
  'Entre na sua conta para excluir a conta.';
export const DELETE_SESSION_EXPIRED =
  'Sessao expirada. Entre novamente para excluir a conta.';
export const DELETE_FAILED =
  'Nao foi possivel excluir a conta. Tente novamente.';
export const DELETE_CONFIRM_MISMATCH =
  'A confirmacao nao confere. A exclusao nao foi enviada.';

/** Chaves que nao podem aparecer no download nem na UI. */
const SENSITIVE_EXPORT_KEYS = new Set([
  'password',
  'password_hash',
  'passwd',
  'hash',
  'access_token',
  'refresh_token',
  'jwt',
  'token',
  'authorization',
]);

export function isExactDeleteConfirm(value: string): boolean {
  return value === DELETE_ACCOUNT_CONFIRM;
}

/** Remove senha, hash e tokens em qualquer nivel. O restante do JSON permanece. */
export function omitSensitiveExportKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitSensitiveExportKeys(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_EXPORT_KEYS.has(key.toLowerCase())) {
      continue;
    }
    next[key] = omitSensitiveExportKeys(item);
  }
  return next;
}

export function parseUserDataExport(payload: unknown): UserDataExport {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta de exportacao em formato invalido');
  }
  return payload as UserDataExport;
}

export function parseDeleteAccountResponse(payload: unknown): DeleteAccountResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta de exclusao em formato invalido');
  }
  const record = payload as Record<string, unknown>;
  if (record.deleted !== true) {
    throw new Error('Resposta de exclusao em formato invalido');
  }
  return {
    deleted: true,
    user_id: typeof record.user_id === 'string' ? record.user_id : undefined,
    deleted_at:
      typeof record.deleted_at === 'string' ? record.deleted_at : undefined,
  };
}

export function lgpdErrorLeaksInternals(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('http://') || lower.includes('https://')) {
    return true;
  }
  if (
    lower.includes('/users/me') ||
    lower.includes('/legal/') ||
    lower.includes('/auth/')
  ) {
    return true;
  }
  if (lower.includes('authorization') || lower.includes('bearer ')) {
    return true;
  }
  if (/\.py\b/.test(lower) || lower.includes('traceback')) {
    return true;
  }
  if (
    lower.includes('jwt-') ||
    lower.includes('access_token') ||
    lower.includes('password')
  ) {
    return true;
  }
  return false;
}

export function safeExportErrorMessage(error: unknown): string {
  return safeLgpdErrorMessage(error, {
    loginRequired: EXPORT_LOGIN_REQUIRED,
    sessionExpired: EXPORT_SESSION_EXPIRED,
    failed: EXPORT_FAILED,
  });
}

export function safeDeleteErrorMessage(error: unknown): string {
  return safeLgpdErrorMessage(error, {
    loginRequired: DELETE_LOGIN_REQUIRED,
    sessionExpired: DELETE_SESSION_EXPIRED,
    failed: DELETE_FAILED,
  });
}

function safeLgpdErrorMessage(
  error: unknown,
  copy: { loginRequired: string; sessionExpired: string; failed: string },
): string {
  if (error && typeof error === 'object') {
    const record = error as LgpdErrorLike;
    if (record.outdated?.message?.trim()) {
      return record.outdated.message;
    }
    if (record.message === copy.loginRequired) {
      return copy.loginRequired;
    }
    if (record.status === 401) {
      return copy.sessionExpired;
    }
  }
  return copy.failed;
}

export function triggerJsonDownload(
  payload: UserDataExport,
  fileName: string = EXPORT_DOWNLOAD_FILENAME,
  createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  clickAnchor: (anchor: HTMLAnchorElement) => void = (anchor) => anchor.click(),
): void {
  const blob = new Blob([JSON.stringify(payload)], {
    type: 'application/json',
  });
  const href = createObjectUrl(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  clickAnchor(anchor);
  revokeObjectUrl(href);
}
