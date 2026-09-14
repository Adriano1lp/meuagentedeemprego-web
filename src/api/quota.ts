import type { QuotaCode, QuotaDetail } from './types';

export const QUOTA_EXCEEDED = 'QUOTA_EXCEEDED';
export const SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED';

const DEFAULT_MESSAGES: Record<QuotaCode, string> = {
  QUOTA_EXCEEDED: 'Cota mensal do plano Essencial esgotada.',
  SUBSCRIPTION_REQUIRED:
    'Cota gratuita do mes esgotada. Assine o plano Essencial para continuar.',
};

export function isQuotaCode(value: unknown): value is QuotaCode {
  return value === QUOTA_EXCEEDED || value === SUBSCRIPTION_REQUIRED;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function fromQuotaCode(
  code: string | null | undefined,
  extras?: {
    message?: string | null;
    used?: unknown;
    limit?: unknown;
    plan?: unknown;
  },
): QuotaDetail | null {
  const normalized = (code ?? '').trim().toUpperCase();
  if (!isQuotaCode(normalized)) {
    return null;
  }
  const trimmed = (extras?.message ?? '').trim();
  return {
    code: normalized,
    message: trimmed || DEFAULT_MESSAGES[normalized],
    used: asOptionalNumber(extras?.used),
    limit: asOptionalNumber(extras?.limit),
    plan: asOptionalString(extras?.plan),
  };
}

function extractQuotaFromPayload(payload: unknown): QuotaDetail | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const detail = record.detail ?? record;

  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const detailRecord = detail as Record<string, unknown>;
    return fromQuotaCode(
      typeof detailRecord.code === 'string' ? detailRecord.code : null,
      {
        message:
          typeof detailRecord.message === 'string'
            ? detailRecord.message
            : null,
        used: detailRecord.used,
        limit: detailRecord.limit,
        plan: detailRecord.plan,
      },
    );
  }

  if (typeof detail === 'string') {
    if (detail.includes(QUOTA_EXCEEDED)) {
      return fromQuotaCode(QUOTA_EXCEEDED, { message: detail });
    }
    if (detail.includes(SUBSCRIPTION_REQUIRED)) {
      return fromQuotaCode(SUBSCRIPTION_REQUIRED, { message: detail });
    }
  }

  return null;
}

/** 402 com detail.code QUOTA_EXCEEDED | SUBSCRIPTION_REQUIRED. */
export function parseQuotaResponse(
  status: number,
  payload: unknown,
): QuotaDetail | null {
  if (status !== 402) {
    return null;
  }
  return extractQuotaFromPayload(payload);
}
