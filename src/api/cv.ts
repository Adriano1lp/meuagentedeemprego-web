import type { RebuildEmbeddingsResponse, UploadCvResponse } from './types';

/** Default de MAX_UPLOAD_SIZE_MB no backend (config.py). */
export const MAX_CV_UPLOAD_BYTES = 10 * 1024 * 1024;

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
    cv_file: asOptionalString(record.cv_file),
    original_file: asOptionalString(record.original_file),
    object_key: asOptionalString(record.object_key),
    extracted_text_object_key: asOptionalString(record.extracted_text_object_key),
  };
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
    cv_file: asOptionalString(record.cv_file),
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
