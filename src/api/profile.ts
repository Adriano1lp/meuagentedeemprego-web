import type { CurrentUser } from './types';

type ProfileErrorLike = {
  status?: number;
  message?: string;
  outdated?: { message?: string } | null;
};

export const CURRENT_USER_PATH = '/users/me';

export const PROFILE_LOGIN_REQUIRED =
  'Entre na sua conta para ver o perfil.';
export const PROFILE_SESSION_EXPIRED =
  'Sessao expirada. Entre novamente para ver o perfil.';
export const PROFILE_LOAD_FAILED =
  'Nao foi possivel carregar o perfil. Tente novamente.';
export const PRIVACY_LOAD_FAILED =
  'Nao foi possivel carregar a politica de privacidade. Tente novamente.';

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Espelha GET /users/me. So copia campos que o JSON trouxer.
 * Nao preenche plano, status, cota ou nome em falta.
 */
export function parseCurrentUser(payload: unknown): CurrentUser {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta de perfil em formato invalido');
  }
  const record = payload as Record<string, unknown>;
  return {
    user_id: asOptionalString(record.user_id),
    email: asOptionalString(record.email),
    display_name: asOptionalString(record.display_name),
    plan: asOptionalString(record.plan),
    subscription_status: asOptionalString(record.subscription_status),
  };
}

export function hasProfileIdentity(user: CurrentUser): boolean {
  return Boolean(
    user.display_name || user.email || user.plan || user.subscription_status,
  );
}

/** Rotulos dos valores reais de subscription_status (billing.py). Valor desconhecido fica cru. */
export function subscriptionStatusLabel(
  status: string | undefined,
): string | null {
  if (!status) {
    return null;
  }
  const normalized = status.trim().toLowerCase();
  if (normalized === 'none') {
    return 'Sem assinatura';
  }
  if (normalized === 'active') {
    return 'Ativa';
  }
  if (normalized === 'past_due') {
    return 'Pagamento pendente';
  }
  if (normalized === 'canceled') {
    return 'Cancelada';
  }
  return status.trim();
}

export function profileErrorLeaksInternals(message: string): boolean {
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
  if (lower.includes('jwt-') || lower.includes('access_token')) {
    return true;
  }
  return false;
}

export function safeProfileErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as ProfileErrorLike;
    if (record.outdated?.message?.trim()) {
      return record.outdated.message;
    }
    if (record.message === PROFILE_LOGIN_REQUIRED) {
      return PROFILE_LOGIN_REQUIRED;
    }
    if (record.status === 401) {
      return PROFILE_SESSION_EXPIRED;
    }
  }
  return PROFILE_LOAD_FAILED;
}
