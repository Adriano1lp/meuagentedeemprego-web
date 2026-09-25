import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from '../api/client';
import {
  COVER_LETTER_BAD_REQUEST,
  COVER_LETTER_COMPANY_REQUIRED,
  COVER_LETTER_FAILED,
  COVER_LETTER_LOGIN_REQUIRED,
  COVER_LETTER_PATH,
  COVER_LETTER_QUOTA,
  COVER_LETTER_SESSION_EXPIRED,
  coverLetterErrorLeaksInternals,
  coverLetterFileName,
  parseCoverLetterResponse,
} from '../api/coverLetter';

const letterBody = {
  texto_resposta: 'Ola, Acme.\n\nSegue minha candidatura.',
  pdf_url: '/users/me/files/carta-acme.pdf',
  user_id: 'user-1',
};

describe('parseCoverLetterResponse', () => {
  it('preserva quebras de linha e aceita pdf_url relativo', () => {
    const parsed = parseCoverLetterResponse(letterBody);
    expect(parsed.texto_resposta).toBe('Ola, Acme.\n\nSegue minha candidatura.');
    expect(parsed.pdf_url).toBe('/users/me/files/carta-acme.pdf');
    expect(parsed.user_id).toBe('user-1');
    expect(coverLetterFileName(parsed.pdf_url)).toBe('carta-acme.pdf');
  });

  it('resolve nome do PDF em URL absoluta sem levar query nem token', () => {
    expect(
      coverLetterFileName(
        'https://cdn.evil.test/users/me/files/carta-acme.pdf?token=jwt-abc',
      ),
    ).toBe('carta-acme.pdf');
    expect(
      coverLetterFileName('users/me/files/carta-acme.pdf'),
    ).toBe('carta-acme.pdf');
  });
});

describe('api.createCoverLetter', () => {
  it('POST /users/me/cover-letter envia Bearer e nunca X-User-Id', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`https://api.example.test${COVER_LETTER_PATH}`);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ empresa: 'Acme' });
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('X-User-Id')).toBeNull();
      expect(headers.get('x-user-id')).toBeNull();
      return new Response(JSON.stringify(letterBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const result = await api.createCoverLetter('  Acme  ');
    expect(result.texto_resposta).toContain('\n\n');
    expect(result.user_id).toBe('user-1');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sem JWT ou empresa vazia nao chama a API', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('nao deveria chamar fetch');
    });

    for (const token of [null, '', '   ']) {
      const api = createApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl,
        getToken: () => token,
      });
      await expect(api.createCoverLetter('Acme')).rejects.toMatchObject({
        status: 401,
        message: COVER_LETTER_LOGIN_REQUIRED,
      });
    }

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });
    for (const empresa of ['', '   ']) {
      await expect(api.createCoverLetter(empresa)).rejects.toMatchObject({
        status: 400,
        message: COVER_LETTER_COMPANY_REQUIRED,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401, 400, 5xx e rede nao vazam path, URL ou token', async () => {
    const unauthorized = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            detail: 'Header Authorization obrigatorio Bearer jwt-abc',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }),
      getToken: () => 'jwt-should-not-leak',
    });
    await expect(unauthorized.createCoverLetter('Acme')).rejects.toMatchObject({
      status: 401,
      message: COVER_LETTER_SESSION_EXPIRED,
    });

    const badRequest = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            detail: 'empresa vazia em POST /users/me/cover-letter',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }),
      getToken: () => 'jwt-should-not-leak',
    });
    try {
      await badRequest.createCoverLetter('Acme');
      throw new Error('esperava ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.message).toBe(COVER_LETTER_BAD_REQUEST);
      expect(coverLetterErrorLeaksInternals(apiError.message)).toBe(false);
    }

    const server = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            detail:
              'File "/app/main.py", line 9, in cover_letter GET /users/me/cover-letter',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }),
      getToken: () => 'jwt-should-not-leak',
    });
    await expect(server.createCoverLetter('Acme')).rejects.toMatchObject({
      status: 500,
      message: COVER_LETTER_FAILED,
    });

    const offline = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: vi.fn(async () => {
        throw new TypeError(
          'Failed to fetch https://meu-agente-de-emprego.onrender.com/users/me/cover-letter',
        );
      }),
      getToken: () => 'jwt-memoria',
    });
    try {
      await offline.createCoverLetter('Acme');
      throw new Error('esperava ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe(COVER_LETTER_FAILED);
      expect(apiError.message).not.toContain('onrender.com');
      expect(coverLetterErrorLeaksInternals(apiError.message)).toBe(false);
    }
  });

  it('402 e 429 viram limite sem mensagem de pagamento', async () => {
    for (const status of [402, 429]) {
      const api = createApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn(async () => {
          return new Response(
            JSON.stringify({
              detail: {
                code: 'SUBSCRIPTION_REQUIRED',
                message:
                  'Assine o plano Essencial em https://billing.example/checkout',
              },
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          );
        }),
        getToken: () => 'jwt-memoria',
      });
      try {
        await api.createCoverLetter('Acme');
        throw new Error('esperava ApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.status).toBe(status);
        expect(apiError.message).toBe(COVER_LETTER_QUOTA);
        expect(apiError.message.toLowerCase()).not.toContain('assine');
        expect(apiError.message.toLowerCase()).not.toContain('checkout');
        expect(coverLetterErrorLeaksInternals(apiError.message)).toBe(false);
      }
    }
  });

  it('403 OUTDATED continua com detail.code para o ConsentGate', async () => {
    const onOutdated = vi.fn();
    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            detail: {
              code: 'PRIVACY_OUTDATED',
              message:
                'Politica de privacidade desatualizada. Reaceite a versao vigente.',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }),
      getToken: () => 'jwt-memoria',
      onOutdated,
    });

    await expect(api.createCoverLetter('Acme')).rejects.toMatchObject({
      status: 403,
      outdated: { code: 'PRIVACY_OUTDATED' },
    });
    expect(onOutdated).toHaveBeenCalledOnce();
  });

  it('baixa o PDF pela base configurada, com Bearer, sem token na URL', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.4\ncarta');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe(
        'https://api.example.test/users/me/files/carta-acme.pdf',
      );
      expect(url).not.toContain('token');
      expect(url).not.toContain('jwt-memoria');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('X-User-Id')).toBeNull();
      return new Response(pdfBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test/',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });
    const fileName = coverLetterFileName(
      'https://cdn.evil.test/users/me/files/carta-acme.pdf?access_token=jwt-memoria',
    );
    expect(fileName).toBe('carta-acme.pdf');
    const body = await api.downloadUserFile(fileName!);
    expect(new TextDecoder().decode(body).startsWith('%PDF')).toBe(true);
  });
});
