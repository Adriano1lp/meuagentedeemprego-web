import type { RebuildEmbeddingsResponse, UploadCvResponse } from './types';

/** Default de MAX_UPLOAD_SIZE_MB no backend (config.py). */
export const MAX_CV_UPLOAD_BYTES = 10 * 1024 * 1024;

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asOptionalId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asRecord(payload: unknown, label: string): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Resposta de ${label} em formato invalido`);
  }
  return payload as Record<string, unknown>;
}

export function parseUploadCvResponse(payload: unknown): UploadCvResponse {
  const record = asRecord(payload, 'upload');
  return {
    user_id: asOptionalString(record.user_id),
    document_id: asOptionalId(record.document_id),
    filename: asOptionalString(record.filename),
    content_type: asOptionalString(record.content_type),
    bytes_received: asOptionalNumber(record.bytes_received),
    updated_at: asOptionalString(record.updated_at),
    has_cv: asOptionalBoolean(record.has_cv),
    has_embeddings: asOptionalBoolean(record.has_embeddings),
    ready_for_analysis: asOptionalBoolean(record.ready_for_analysis),
    reason: asOptionalString(record.reason),
  };
}

export const CV_NOT_READY =
  'Não conseguimos processar seu currículo. Tente de novo.';
export const CV_UPLOAD_BAD_REQUEST =
  'Não conseguimos ler esse arquivo. Envie um PDF ou TXT com texto.';
export const CV_REBUILD_BAD_REQUEST =
  'Não conseguimos processar seu currículo. Envie o arquivo de novo.';
export const CV_TOO_LARGE = 'Arquivo muito grande. O limite é 10 MB.';
export const CV_INVALID =
  'Não conseguimos processar esse envio. Confira o arquivo e tente de novo.';
export const CV_OFFLINE = 'Sem conexão. Verifique sua internet.';
export const CV_SESSION = 'Sessão expirada. Entre novamente para continuar.';
export const CV_UNAVAILABLE =
  'Serviço indisponível no momento. Tente de novo em instantes.';

const CV_LIMIT_DETAIL = /limite|MB|excede/i;

export type CvOperation = 'upload' | 'rebuild';

export function isCvFileTooLarge(file: File): boolean {
  return file.size > MAX_CV_UPLOAD_BYTES;
}

/**
 * Texto fixo por status. `internalDetail` só classifica 400 de limite
 * e nunca é devolvido.
 */
export function cvFailureMessage(
  operation: CvOperation,
  status: number,
  internalDetail?: string | null,
): string {
  const limit =
    typeof internalDetail === 'string' && CV_LIMIT_DETAIL.test(internalDetail);
  if (status === 413 || (status === 400 && limit)) {
    return CV_TOO_LARGE;
  }
  if (status === 400) {
    return operation === 'upload' ? CV_UPLOAD_BAD_REQUEST : CV_REBUILD_BAD_REQUEST;
  }
  if (status === 422) {
    return CV_INVALID;
  }
  if (status === 401 || status === 403) {
    return CV_SESSION;
  }
  if (status === 0) {
    return CV_OFFLINE;
  }
  return CV_UNAVAILABLE;
}

/** '503 Servico indisponivel' e variantes sem acento ou com código HTTP visível. */
export function mentionsRawUnavailable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed === CV_UNAVAILABLE) {
    return false;
  }
  if (/servico\s+indisponivel/i.test(trimmed)) {
    return true;
  }
  return /^\d{3}\b[\s.:_-]*servi[cç]o\s+indispon[ií]vel/i.test(trimmed);
}

/** pt-BR em America/Sao_Paulo, ex. 18/10/2026 às 15h40. Data inválida some. */
export function formatCvUpdatedAt(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const day = pick('day');
  const month = pick('month');
  const year = pick('year');
  const hour = pick('hour');
  const minute = pick('minute');
  if (!day || !month || !year || hour === '' || minute === '') {
    return null;
  }
  return `${day}/${month}/${year} às ${hour}h${minute}`;
}

export function parseRebuildEmbeddingsResponse(
  payload: unknown,
): RebuildEmbeddingsResponse {
  const record = asRecord(payload, 'embeddings');
  return {
    user_id: asOptionalString(record.user_id),
    embedding_run_id: asOptionalId(record.embedding_run_id),
    chunks: asOptionalNumber(record.chunks),
    processed_at: asOptionalString(record.processed_at),
    embedding_model: asOptionalString(record.embedding_model),
    chroma_dir: asOptionalString(record.chroma_dir),
    vector_store: asOptionalString(record.vector_store),
  };
}

/** Contrato do servidor: .pdf ou .txt. Formato invalido fica a cargo da API 400. */
export function isAllowedCvExtension(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.txt') ||
    file.type === 'application/pdf' ||
    file.type === 'text/plain'
  );
}
