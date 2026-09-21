import type { GapHistoryItem, GapHistoryResponse } from './types';

type HistoryErrorLike = {
  status?: number;
  message?: string;
  outdated?: { message?: string } | null;
};

export const GAP_HISTORY_PATH = '/users/me/gap-history';
export const DEFAULT_GAP_HISTORY_LIMIT = 20;
export const DEFAULT_GAP_HISTORY_OFFSET = 0;
export const MAX_GAP_HISTORY_LIMIT = 100;

export const HISTORY_LOGIN_REQUIRED =
  'Entre na sua conta para ver o historico.';
export const HISTORY_SESSION_EXPIRED =
  'Sessao expirada. Entre novamente para ver o historico.';
export const HISTORY_LOAD_FAILED =
  'Nao foi possivel carregar o historico. Tente novamente.';

export type GapHistoryQuery = {
  limit?: number;
  offset?: number;
};

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return asOptionalString(value) ?? undefined;
}

function asMatchScore(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (item == null ? '' : String(item).trim()))
    .filter((item) => item.length > 0);
}

function asOptionalId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GAP_HISTORY_LIMIT;
  }
  return Math.min(
    MAX_GAP_HISTORY_LIMIT,
    Math.max(1, Math.trunc(value)),
  );
}

function clampOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GAP_HISTORY_OFFSET;
  }
  return Math.max(0, Math.trunc(value));
}

export function buildGapHistoryPath(query: GapHistoryQuery = {}): string {
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  return `${GAP_HISTORY_PATH}?limit=${limit}&offset=${offset}`;
}

export function extractGapHistoryItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return items;
    }
  }
  return [];
}

export function parseGapHistoryItem(
  payload: unknown,
): GapHistoryItem | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const id = asOptionalId(record.id ?? record.insight_id);
  if (!id) {
    return null;
  }

  return {
    id,
    processing_run_id:
      typeof record.processing_run_id === 'number' ||
      typeof record.processing_run_id === 'string'
        ? record.processing_run_id
        : undefined,
    created_at: asOptionalString(record.created_at),
    job_title: asOptionalString(record.job_title),
    company_name: asOptionalString(record.company_name),
    job_summary: asOptionalString(record.job_summary),
    match_score: asMatchScore(record.match_score),
    strengths: asStringList(record.strengths),
    critical_gaps: asStringList(record.critical_gaps),
    matching_skills: asStringList(record.matching_skills),
    missing_skills: asStringList(record.missing_skills),
    status: asOptionalString(record.status),
    generation_blocked: record.generation_blocked === true,
    blocked_reason: asNullableString(record.blocked_reason) ?? null,
    source: asOptionalString(record.source),
  };
}

/**
 * Aceita `{ items, limit, offset }` (OpenAPI live) ou lista vazia/nua.
 * Linhas sem `id`/`insight_id` sao ignoradas — nunca misturam dados invalidos.
 */
export function parseGapHistoryResponse(payload: unknown): GapHistoryResponse {
  const rawItems = extractGapHistoryItems(payload);
  const items = rawItems
    .map((item) => parseGapHistoryItem(item))
    .filter((item): item is GapHistoryItem => item != null);

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return {
      items,
      limit:
        typeof record.limit === 'number' && Number.isFinite(record.limit)
          ? record.limit
          : undefined,
      offset:
        typeof record.offset === 'number' && Number.isFinite(record.offset)
          ? record.offset
          : undefined,
    };
  }

  return { items };
}

/** dd/mm/aaaa HH:mm em UTC — so para exibicao; o `datetime` fica no ISO. */
export function formatHistoryDate(
  value: string | undefined,
): string | null {
  if (!value?.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function historyErrorLeaksInternals(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('http://') || lower.includes('https://')) {
    return true;
  }
  if (lower.includes('/users/me') || lower.includes('gap-history')) {
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

export function safeHistoryErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as HistoryErrorLike;
    if (record.outdated?.message?.trim()) {
      return record.outdated.message;
    }
    if (record.message === HISTORY_LOGIN_REQUIRED) {
      return HISTORY_LOGIN_REQUIRED;
    }
    if (record.status === 401) {
      return HISTORY_SESSION_EXPIRED;
    }
  }
  return HISTORY_LOAD_FAILED;
}
