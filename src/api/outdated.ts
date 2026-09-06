import { LegalDoc, type LegalDocId } from '../legal/versions';

export const TERMS_OUTDATED = 'TERMS_OUTDATED';
export const PRIVACY_OUTDATED = 'PRIVACY_OUTDATED';

export type OutdatedCode = typeof TERMS_OUTDATED | typeof PRIVACY_OUTDATED;

export type OutdatedDetail = {
  code: OutdatedCode;
  message: string;
  doc: LegalDocId;
};

const DEFAULT_MESSAGES: Record<OutdatedCode, string> = {
  TERMS_OUTDATED: 'Termos de uso desatualizados. Reaceite a versao vigente.',
  PRIVACY_OUTDATED:
    'Politica de privacidade desatualizada. Reaceite a versao vigente.',
};

export function isOutdatedCode(value: unknown): value is OutdatedCode {
  return value === TERMS_OUTDATED || value === PRIVACY_OUTDATED;
}

export function outdatedCodeToDoc(code: OutdatedCode): LegalDocId {
  return code === TERMS_OUTDATED ? LegalDoc.terms : LegalDoc.privacy;
}

function extractCodeFromString(value: string): string | null {
  if (value.includes(TERMS_OUTDATED)) {
    return TERMS_OUTDATED;
  }
  if (value.includes(PRIVACY_OUTDATED)) {
    return PRIVACY_OUTDATED;
  }
  return value.trim() || null;
}

export function fromOutdatedCode(
  code: string | null | undefined,
  message?: string | null,
): OutdatedDetail | null {
  const normalized = (code ?? '').trim().toUpperCase();
  if (!isOutdatedCode(normalized)) {
    return null;
  }
  const trimmed = (message ?? '').trim();
  return {
    code: normalized,
    doc: outdatedCodeToDoc(normalized),
    message: trimmed || DEFAULT_MESSAGES[normalized],
  };
}

/** Interpreta `detail.code` (e variantes da API) sem exigir status HTTP. */
export function parseOutdatedError(payload: unknown): OutdatedDetail | null {
  let code: string | null = null;
  let message: string | null = null;

  if (typeof payload === 'string') {
    code = extractCodeFromString(payload);
    message = payload;
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const detail = record.detail ?? record.code;

    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const detailRecord = detail as Record<string, unknown>;
      code = typeof detailRecord.code === 'string' ? detailRecord.code : null;
      message =
        typeof detailRecord.message === 'string' ? detailRecord.message : null;
    } else if (typeof detail === 'string') {
      code = extractCodeFromString(detail);
      message = detail;
    } else if (typeof record.code === 'string') {
      code = record.code;
      message = typeof record.message === 'string' ? record.message : null;
    }
  }

  return fromOutdatedCode(code, message);
}

/** Parser de 403 OUTDATED: so considera bloqueio de consentimento em HTTP 403. */
export function parseOutdatedResponse(
  status: number,
  payload: unknown,
): OutdatedDetail | null {
  if (status !== 403) {
    return null;
  }
  return parseOutdatedError(payload);
}
