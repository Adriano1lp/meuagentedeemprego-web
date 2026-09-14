import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../api/client';

const pdfUrl =
  'https://meu-agente-de-emprego.onrender.com/users/me/files/abc-123.pdf';

describe('api.getStatus / processar / downloadUserFile', () => {
  it('GET /users/me/status envia Bearer e nao calcula cota', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/users/me/status');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('X-User-Id')).toBeNull();
      return new Response(
        JSON.stringify({
          user_id: 'user-1',
          has_cv: true,
          has_embeddings: true,
          generated_files: 0,
          plan: 'free',
          used: 2,
          limit: 5,
          remaining: 3,
          period: '2026-09',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const status = await api.getStatus();
    expect(status.used).toBe(2);
    expect(status.limit).toBe(5);
    expect(status.remaining).toBe(3);
    expect(window.localStorage.getItem('mae-quota')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('POST /processar envia RequestData.texto', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/processar');
      expect(JSON.parse(String(init?.body))).toEqual({
        texto: 'Vaga para desenvolvedor Python',
      });
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      return new Response(
        JSON.stringify({
          texto_resposta: 'Analise ok',
          pdf_url: pdfUrl,
          match_score: 80,
          pdf_generated: true,
          generation_blocked: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const result = await api.processar('Vaga para desenvolvedor Python');
    expect(result.pdf_url).toBe(pdfUrl);
    expect(result.generation_blocked).toBe(false);
  });

  it('402 vira ApiError.quota sem sucesso', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail: {
            code: 'SUBSCRIPTION_REQUIRED',
            message: 'Cota gratuita do mes esgotada.',
            used: 5,
            limit: 5,
            plan: 'free',
          },
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    await expect(api.processar('Vaga para analista')).rejects.toMatchObject({
      status: 402,
      quota: { code: 'SUBSCRIPTION_REQUIRED' },
    });
  });

  it('400 vira erro acionavel, nao sucesso', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail:
            'Embeddings do usuario nao encontrados. Envie o curriculo e execute POST /users/me/rebuild-embeddings antes de processar a vaga.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    await expect(api.processar('Vaga para analista')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Embeddings do usuario nao encontrados'),
      quota: null,
    });
  });

  it('GET /users/me/files/{file_name} devolve bytes com Bearer', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%mae');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://api.example.test/users/me/files/abc-123.pdf',
      );
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      return new Response(pdfBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const body = await api.downloadUserFile('abc-123.pdf');
    expect(new TextDecoder().decode(body).startsWith('%PDF')).toBe(true);
  });
});
