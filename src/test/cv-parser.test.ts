import { describe, expect, it } from 'vitest';

import {
  isAllowedCvExtension,
  parseRebuildEmbeddingsResponse,
  parseUploadCvResponse,
} from '../api/cv';

describe('parseUploadCvResponse', () => {
  it('espelha os campos reais de POST /users/me/upload-cv', () => {
    const parsed = parseUploadCvResponse({
      user_id: 'user-1',
      document_id: 42,
      filename: 'cv.pdf',
      content_type: 'application/pdf',
      bytes_received: 2048,
      updated_at: '2026-09-14T12:00:00+00:00',
      cv_file: '/data/cv.txt',
      original_file: '/data/cv_original.pdf',
      object_key: 'users/user-1/documents/cv_original.pdf',
      extracted_text_object_key: 'users/user-1/documents/cv.txt',
    });

    expect(parsed).toEqual({
      user_id: 'user-1',
      document_id: '42',
      filename: 'cv.pdf',
      content_type: 'application/pdf',
      bytes_received: 2048,
      updated_at: '2026-09-14T12:00:00+00:00',
      cv_file: '/data/cv.txt',
      original_file: '/data/cv_original.pdf',
      object_key: 'users/user-1/documents/cv_original.pdf',
      extracted_text_object_key: 'users/user-1/documents/cv.txt',
    });
  });

  it('rejeita payload que nao e objeto', () => {
    expect(() => parseUploadCvResponse('ok')).toThrow(/upload/);
    expect(() => parseUploadCvResponse(null)).toThrow(/upload/);
  });
});

describe('parseRebuildEmbeddingsResponse', () => {
  it('espelha os campos reais de POST /users/me/rebuild-embeddings', () => {
    const parsed = parseRebuildEmbeddingsResponse({
      user_id: 'user-1',
      embedding_run_id: 'run-9',
      chunks: 12,
      processed_at: '2026-09-14T12:01:00+00:00',
      embedding_model: 'text-embedding-3-small',
      chroma_dir: '/data/chroma',
      vector_store: 'mongodb',
      cv_file: '/data/cv.txt',
    });

    expect(parsed.chunks).toBe(12);
    expect(parsed.processed_at).toBe('2026-09-14T12:01:00+00:00');
    expect(parsed.embedding_model).toBe('text-embedding-3-small');
    expect(parsed.vector_store).toBe('mongodb');
    expect(parsed.embedding_run_id).toBe('run-9');
  });

  it('rejeita payload que nao e objeto', () => {
    expect(() => parseRebuildEmbeddingsResponse([])).toThrow(/embeddings/);
  });
});

describe('isAllowedCvExtension', () => {
  it('aceita .pdf e .txt e recusa .docx', () => {
    expect(
      isAllowedCvExtension(
        new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
      ),
    ).toBe(true);
    expect(
      isAllowedCvExtension(
        new File(['texto do cv'], 'cv.txt', { type: 'text/plain' }),
      ),
    ).toBe(true);
    expect(
      isAllowedCvExtension(
        new File(['docx'], 'cv.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe(false);
  });
});
