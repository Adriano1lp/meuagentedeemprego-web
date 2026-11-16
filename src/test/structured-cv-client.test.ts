import { describe, expect, it, vi } from 'vitest';

import { ApiError, RETRY_AFTER_MAX_SECONDS, createApiClient } from '../api/client';
import { CV_FORM_TOO_LARGE } from '../api/structuredCv';
import { CV_STRUCTURED_CONSENT_VERSION } from '../api/types';

const payload = {
  identificacao: {
    nome: 'Ana Silva',
    cidade: 'Campinas',
    uf: 'SP' as const,
    modalidade: 'remoto' as const,
    telefone: '11987654321',
    cargos_alvo: ['Analista de dados'],
    senioridade: 'pleno' as const,
  },
  resumo: 'a'.repeat(320),
  primeiro_emprego: true,
  experiencias: [],
  formacoes: [],
  cursos: [],
  habilidades_tecnicas: ['Python', 'SQL', 'ETL'],
  habilidades_comportamentais: [],
  idiomas: [],
  links: [],
  consentimento: {
    aceito: true as const,
    versao_termo: CV_STRUCTURED_CONSENT_VERSION,
  },
};

function client(fetchImpl: typeof fetch) {
  return createApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl,
    getToken: () => 'jwt-memoria',
  });
}

describe('cliente /users/me/cv/structured', () => {
  it('POST envia JSON com Bearer e descarta reason e document_id', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/users/me/cv/structured');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('X-User-Id')).toBeNull();
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.email).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/cv_file|object_key|jwt-memoria/);
      return new Response(
        JSON.stringify({
          version: 1,
          document_id: 'doc-1',
          has_cv: true,
          has_embeddings: true,
          ready_for_analysis: true,
          reason: 'nao-mostrar',
          cv_file: '/segredo/cv.txt',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const result = await client(fetchImpl).createStructuredCv(payload);
    expect(result).toEqual({
      has_cv: true,
      has_embeddings: true,
      ready_for_analysis: true,
    });
  });

  it('preserva o corpo do 422 e o Retry-After do 429', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(
          JSON.stringify({
            detail: [{ type: 'value_error', loc: ['body', 'resumo'], msg: 'tamanho invalido' }],
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ detail: 'Muitas alteracoes' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '12',
        },
      });
    });
    const api = client(fetchImpl);
    await expect(api.updateStructuredCv(payload)).rejects.toMatchObject({
      status: 422,
      body: {
        detail: [{ loc: ['body', 'resumo'], msg: 'tamanho invalido', type: 'value_error' }],
      },
    });
    try {
      await api.createStructuredCv(payload);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).retryAfterSeconds).toBe(12);
      expect((error as ApiError).body).toBeNull();
      expect((error as ApiError).message).not.toMatch(/Retry-After|Muitas alteracoes/i);
    }
  });

  it('Retry-After acima de 3600 ou inválido não trava o retry', async () => {
    const far = new Date(Date.now() + (RETRY_AFTER_MAX_SECONDS + 60) * 1000).toUTCString();
    const cases: Array<[string | undefined, number | null]> = [
      ['12', 12],
      ['3600', 3600],
      ['3601', null],
      ['99999', null],
      ['nao', null],
      ['-5', null],
      [far, null],
    ];
    for (const [header, expected] of cases) {
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'limite' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...(header ? { 'Retry-After': header } : {}),
          },
        }),
      );
      try {
        await client(fetchImpl).createStructuredCv(payload);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).retryAfterSeconds).toBe(expected);
        expect((error as ApiError).message).not.toMatch(/99999|Retry-After/i);
      }
    }
  });

  it('não envia o corpo quando ele passa de 64 KB', async () => {
    const fetchImpl = vi.fn();
    const api = client(fetchImpl);
    await expect(
      api.createStructuredCv({ ...payload, resumo: 'a'.repeat(70_000) }),
    ).rejects.toMatchObject({ status: 413, message: CV_FORM_TOO_LARGE });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
