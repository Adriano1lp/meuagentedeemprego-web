import type { UserStatus } from './types';

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Espelha GET /users/me/status. Nao calcula used/remaining/limit no cliente.
 * Campos de cota so entram se o JSON do status os trouxer (mesmos nomes de
 * GET /billing/me: plan, used, limit, remaining, period, subscription_status).
 */
export function parseUserStatus(payload: unknown): UserStatus {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta de status em formato invalido');
  }
  const record = payload as Record<string, unknown>;
  return {
    user_id: asOptionalString(record.user_id),
    has_cv: asOptionalBoolean(record.has_cv),
    has_profile: asOptionalBoolean(record.has_profile),
    has_embeddings: asOptionalBoolean(record.has_embeddings),
    generated_files: asOptionalNumber(record.generated_files),
    plan: asOptionalString(record.plan),
    subscription_status: asOptionalString(record.subscription_status),
    used: asOptionalNumber(record.used),
    limit: asOptionalNumber(record.limit),
    remaining: asOptionalNumber(record.remaining),
    period: asOptionalString(record.period),
  };
}

/**
 * Gate de Analisar vaga: so `has_embeddings` de GET /users/me/status.
 * Nao inferir prontidao a partir do upload, do rebuild ou de has_cv.
 */
export function canAnalyzeVaga(
  status: UserStatus | null | undefined,
): boolean {
  return status?.has_embeddings === true;
}

export function analyzeBlockReason(
  status: UserStatus | null | undefined,
): string | null {
  if (canAnalyzeVaga(status)) {
    return null;
  }
  if (!status) {
    return 'Aguarde o status do curriculo para analisar a vaga.';
  }
  if (status.has_cv !== true) {
    return 'Sem curriculo valido. Envie um PDF ou TXT para habilitar Analisar vaga.';
  }
  return 'Embeddings ainda nao estao prontos. Envie o curriculo e aguarde o processamento.';
}

export function hasQuotaFields(status: UserStatus): boolean {
  return (
    status.plan != null ||
    status.used != null ||
    status.limit != null ||
    status.remaining != null
  );
}

export function planLabel(plan: string | undefined): string | null {
  if (!plan) {
    return null;
  }
  const normalized = plan.trim().toLowerCase();
  if (normalized === 'free') {
    return 'Free';
  }
  if (normalized === 'essencial') {
    return 'Essencial';
  }
  return plan;
}
