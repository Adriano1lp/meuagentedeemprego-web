import { describe, expect, it } from 'vitest';

import {
  MAX_CV_UPLOAD_BYTES,
  parseRebuildEmbeddingsResponse,
  parseUploadCvResponse,
  validatePdfCvFile,
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
    expect(parsed.vector_store).toBe('mongodb');
    expect(parsed.embedding_run_id).toBe('run-9');
  });

  it('rejeita payload que nao e objeto', () => {
    expect(() => parseRebuildEmbeddingsResponse([])).toThrow(/embeddings/);
  });
});

describe('validatePdfCvFile', () => {
  it('aceita PDF e recusa vazio, outro tipo e arquivo acima de 10 MB', () => {
    expect(validatePdfCvFile(null)).toMatch(/PDF/);
    expect(
      validatePdfCvFile(new File([], 'cv.pdf', { type: 'application/pdf' })),
    ).toMatch(/vazio/);
    expect(
      validatePdfCvFile(new File(['texto'], 'cv.txt', { type: 'text/plain' })),
    ).toMatch(/PDF/);
    expect(
      validatePdfCvFile(
        new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
      ),
    ).toBeNull();

    const tooBig = new File(['%PDF-1.4'], 'cv.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(tooBig, 'size', { value: MAX_CV_UPLOAD_BYTES + 1 });
    expect(validatePdfCvFile(tooBig)).toMatch(/10 MB/);
  });
});
