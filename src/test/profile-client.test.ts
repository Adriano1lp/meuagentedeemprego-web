import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from '../api/client';
import {
  CURRENT_USER_PATH,
  profileErrorLeaksInternals,
  PROFILE_LOAD_FAILED,
  PROFILE_LOGIN_REQUIRED,
  PROFILE_SESSION_EXPIRED,
} from '../api/profile';

const currentUserBody = {
  user_id: 'user-1',
  auth_mode: 'jwt',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  plan: 'free',
  subscription_status: 'none',
  used: 4,
  limit: 5,
};

describe('api.getCurrentUser', () => {
  it('GET /users/me envia Bearer e nunca X-User-Id', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`https://api.example.test${CURRENT_USER_PATH}`);
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('X-User-Id')).toBeNull();
      expect(headers.get('x-user-id')).toBeNull();
      return new Response(JSON.stringify(currentUserBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const user = await api.getCurrentUser();
    expect(user.display_name).toBe('Ada Lovelace');
    expect(user.email).toBe('ada@example.com');
    expect(user.plan).toBe('free');
    expect(user.subscription_status).toBe('none');
    expect(user).not.toHaveProperty('used');
    expect(user).not.toHaveProperty('limit');
  });

  it('sem JWT (null ou vazio) nao chama a API nem vaza Authorization', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('nao deveria chamar fetch');
    });

    for (const token of [null, '', '   ']) {
      const api = createApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl,
        getToken: () => token,
      });
      await expect(api.getCurrentUser()).rejects.toMatchObject({
        status: 401,
        message: PROFILE_LOGIN_REQUIRED,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401 vira mensagem sem token, path ou dados de outro usuario', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail: 'Nao autenticado',
          display_name: 'Outra Pessoa',
          email: 'outra@example.com',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-should-not-leak',
    });

    try {
      await api.getCurrentUser();
      throw new Error('esperava ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.message).toBe(PROFILE_SESSION_EXPIRED);
      expect(apiError.message).not.toContain('jwt-should-not-leak');
      expect(apiError.message).not.toContain(CURRENT_USER_PATH);
      expect(apiError.message).not.toContain('Outra Pessoa');
      expect(profileErrorLeaksInternals(apiError.message)).toBe(false);
    }
  });

  it('5xx e rede nao vazam path nem URL da API', async () => {
    const server = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail:
            'File "/app/main.py", line 12, in get_current_user GET /users/me',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const api = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: server,
      getToken: () => 'jwt-should-not-leak',
    });
    await expect(api.getCurrentUser()).rejects.toMatchObject({
      status: 500,
      message: PROFILE_LOAD_FAILED,
    });

    const network = vi.fn(async () => {
      throw new TypeError(
        'Failed to fetch https://meu-agente-de-emprego.onrender.com/users/me',
      );
    });
    const offline = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl: network,
      getToken: () => 'jwt-memoria',
    });
    await expect(offline.getCurrentUser()).rejects.toMatchObject({
      message: PROFILE_LOAD_FAILED,
    });
    expect(profileErrorLeaksInternals(PROFILE_LOAD_FAILED)).toBe(false);
  });

  it('403 OUTDATED continua com detail.code para o ConsentGate', async () => {
    const onOutdated = vi.fn();
    const fetchImpl = vi.fn(async () => {
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
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
      onOutdated,
    });

    await expect(api.getCurrentUser()).rejects.toMatchObject({
      status: 403,
      outdated: { code: 'PRIVACY_OUTDATED' },
    });
    expect(onOutdated).toHaveBeenCalled();
  });
});
