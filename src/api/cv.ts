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

/** Troca mensagem que vazaria path, URL ou token por um texto fixo. */
export function safeCvMessage(message: string, fallback: string): string {
  const lower = message.toLowerCase();
  if (
    /https?:\/\//i.test(message) ||
    message.includes('/') ||
    message.includes('\\') ||
    lower.includes('bearer') ||
    lower.includes('token') ||
    lower.includes('object_key') ||
    lower.includes('cv_file') ||
    lower.includes('original_file')
  ) {
    return fallback;
  }
  const trimmed = message.trim();
  return trimmed || fallback;
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
