import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from '../api/client';
import {
  DELETE_ACCOUNT_BODY,
  DELETE_FAILED,
  DELETE_LOGIN_REQUIRED,
  DELETE_SESSION_EXPIRED,
  EXPORT_DOWNLOAD_FILENAME,
  EXPORT_FAILED,
  EXPORT_LOGIN_REQUIRED,
  EXPORT_PATH,
  EXPORT_SESSION_EXPIRED,
  isExactDeleteConfirm,
  lgpdErrorLeaksInternals,
  omitSensitiveExportKeys,
  parseDeleteAccountResponse,
  parseUserDataExport,
  triggerJsonDownload,
} from '../api/lgpd';
import { CURRENT_USER_PATH } from '../api/profile';

const exportBody = {
  user: {
    user_id: 'user-1',
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
  },
  profile: null,
  processing_runs: [],
  job_analysis_insights: [],
  development_plans: [],
  documents: [{ original_filename: 'curriculo.pdf' }],
  generated_files: [],
  processar_usage: [],
  exported_at: '2026-09-24T12:00:00+00:00',
};

describe('api.exportMyData', () => {
  it('GET /users/me/export envia Bearer e devolve o JSON inteiro', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`https://api.example.test${EXPORT_PATH}`);
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('X-User-Id')).toBeNull();
      expect(headers.get('x-user-id')).toBeNull();
      return new Response(JSON.stringify(exportBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const payload = await api.exportMyData();
    expect(payload).toEqual(exportBody);
    expect(payload).toHaveProperty('documents');
    expect(payload).not.toHaveProperty('password_hash');
  });

  it('sem JWT nao chama a API', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('nao deveria chamar fetch');
    });

    for (const token of [null, '', '   ']) {
      const api = createApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl,
        getToken: () => token,
      });
      await expect(api.exportMyData()).rejects.toMatchObject({
        status: 401,
        message: EXPORT_LOGIN_REQUIRED,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401, 5xx e rede nao vazam path, URL ou token', async () => {
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
    await expect(unauthorized.exportMyData()).rejects.toMatchObject({
      status: 401,
      message: EXPORT_SESSION_EXPIRED,
    });

    const server = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            detail:
              'File "/app/main.py", line 4, in export GET /users/me/export',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }),
      getToken: () => 'jwt-should-not-leak',
    });
    await expect(server.exportMyData()).rejects.toMatchObject({
      status: 500,
      message: EXPORT_FAILED,
    });

    const offline = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: vi.fn(async () => {
        throw new TypeError(
          'Failed to fetch https://meu-agente-de-emprego.onrender.com/users/me/export',
        );
      }),
      getToken: () => 'jwt-memoria',
    });
    await expect(offline.exportMyData()).rejects.toMatchObject({
      message: EXPORT_FAILED,
    });
    expect(lgpdErrorLeaksInternals(EXPORT_FAILED)).toBe(false);
    expect(lgpdErrorLeaksInternals(EXPORT_SESSION_EXPIRED)).toBe(false);
  });

  it('403 OUTDATED continua com detail.code', async () => {
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

    await expect(api.exportMyData()).rejects.toMatchObject({
      status: 403,
      outdated: { code: 'PRIVACY_OUTDATED' },
    });
    expect(onOutdated).toHaveBeenCalledOnce();
  });
});

describe('api.deleteMyAccount', () => {
  it('DELETE /users/me envia Bearer e {"confirm":"DELETE"}', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`https://api.example.test${CURRENT_USER_PATH}`);
      expect(init?.method).toBe('DELETE');
      expect(init?.body).toBe(JSON.stringify(DELETE_ACCOUNT_BODY));
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('X-User-Id')).toBeNull();
      return new Response(
        JSON.stringify({
          user_id: 'user-1',
          deleted: true,
          deleted_at: '2026-09-24T12:00:00+00:00',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    await expect(api.deleteMyAccount()).resolves.toEqual({
      deleted: true,
      user_id: 'user-1',
      deleted_at: '2026-09-24T12:00:00+00:00',
    });
  });

  it('sem JWT nao chama a API', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('nao deveria chamar fetch');
    });
    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => null,
    });
    await expect(api.deleteMyAccount()).rejects.toMatchObject({
      status: 401,
      message: DELETE_LOGIN_REQUIRED,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('400 sem confirm e 401 nao vazam o corpo nem o token', async () => {
    const rejected = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => {
        return new Response(
          JSON.stringify({
            detail: 'Confirmacao obrigatoria. Envie {"confirm": "DELETE"}',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }),
      getToken: () => 'jwt-should-not-leak',
    });
    try {
      await rejected.deleteMyAccount();
      throw new Error('esperava ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.message).toBe(DELETE_FAILED);
      expect(apiError.message).not.toContain('DELETE');
      expect(apiError.message).not.toContain('jwt-should-not-leak');
      expect(lgpdErrorLeaksInternals(apiError.message)).toBe(false);
    }

    const expired = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => {
        return new Response(JSON.stringify({ detail: 'Usuario nao encontrado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
      getToken: () => 'jwt-should-not-leak',
    });
    await expect(expired.deleteMyAccount()).rejects.toMatchObject({
      status: 401,
      message: DELETE_SESSION_EXPIRED,
    });
  });

  it('200 sem deleted true nao e sucesso', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => {
        return new Response(JSON.stringify({ deleted: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
      getToken: () => 'jwt-memoria',
    });
    await expect(api.deleteMyAccount()).rejects.toMatchObject({
      message: DELETE_FAILED,
    });
  });
});

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('confirmacao e dados sensiveis', () => {
  it('so DELETE exato libera a exclusao', () => {
    expect(isExactDeleteConfirm('DELETE')).toBe(true);
    expect(isExactDeleteConfirm('delete')).toBe(false);
    expect(isExactDeleteConfirm('DELETE ')).toBe(false);
    expect(isExactDeleteConfirm('')).toBe(false);
  });

  it('omite password e hash e preserva o resto do JSON', () => {
    expect(
      omitSensitiveExportKeys({
        user: { email: 'ada@example.com', hash: 'segredo', checksum_sha256: 'keep' },
        password: 'senha-plana',
        password_hash: 'hash-secreto',
        documents: [{ original_filename: 'cv.pdf', token: 'nao' }],
      }),
    ).toEqual({
      user: { email: 'ada@example.com', checksum_sha256: 'keep' },
      documents: [{ original_filename: 'cv.pdf' }],
    });
  });
});

describe('parsers e download JSON', () => {
  it('rejeita exportacao que nao e objeto', () => {
    expect(() => parseUserDataExport(null)).toThrow(/formato invalido/);
    expect(() => parseUserDataExport([])).toThrow(/formato invalido/);
  });

  it('so aceita exclusao com deleted true', () => {
    expect(parseDeleteAccountResponse({ deleted: true })).toEqual({
      deleted: true,
      user_id: undefined,
      deleted_at: undefined,
    });
    expect(() => parseDeleteAccountResponse({ deleted: 'true' })).toThrow(
      /formato invalido/,
    );
  });

  it('baixa o JSON como meus-dados.json quando nao ha Content-Disposition', async () => {
    const blobs: Blob[] = [];
    const anchors: HTMLAnchorElement[] = [];
    triggerJsonDownload(
      exportBody,
      EXPORT_DOWNLOAD_FILENAME,
      (blob) => {
        blobs.push(blob);
        return 'blob:export';
      },
      () => undefined,
      (anchor) => {
        anchors.push(anchor);
      },
    );

    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe('application/json');
    expect(JSON.parse(await readBlobText(blobs[0]!))).toEqual(exportBody);
    expect(anchors[0]?.download).toBe('meus-dados.json');
    expect(anchors[0]?.href).toBe('blob:export');
  });
});
