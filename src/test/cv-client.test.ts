import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client';

describe('api.uploadCv / rebuildEmbeddings', () => {
  it('POST /users/me/upload-cv envia multipart field file com Bearer', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/users/me/upload-cv');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      const uploaded = form.get('file');
      expect(uploaded).toBeInstanceOf(File);
      expect((uploaded as File).name).toBe('cv.pdf');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('Content-Type')).toBeNull();
      expect(headers.get('X-User-Id')).toBeNull();
      return new Response(
        JSON.stringify({
          user_id: 'user-1',
          document_id: 'doc-1',
          filename: 'cv.pdf',
          bytes_received: 8,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const file = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });
    const result = await api.uploadCv(file);
    expect(result.filename).toBe('cv.pdf');
    expect(result.document_id).toBe('doc-1');
  });

  it('POST /users/me/rebuild-embeddings nao envia body e usa Bearer', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://api.example.test/users/me/rebuild-embeddings',
      );
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('Content-Type')).toBeNull();
      expect(headers.get('X-User-Id')).toBeNull();
      return new Response(
        JSON.stringify({
          user_id: 'user-1',
          chunks: 4,
          vector_store: 'mongodb',
          processed_at: '2026-09-14T12:01:00+00:00',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const result = await api.rebuildEmbeddings();
    expect(result.chunks).toBe(4);
    expect(result.vector_store).toBe('mongodb');
  });

  it('erro de upload vira ApiError acionavel', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail: 'Formato de arquivo invalido. Envie um arquivo .txt ou .pdf',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    await expect(
      api.uploadCv(new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' })),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Formato de arquivo invalido'),
    });
  });
});
