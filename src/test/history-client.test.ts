import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from '../api/client';
import {
  GAP_HISTORY_PATH,
  historyErrorLeaksInternals,
  HISTORY_LOAD_FAILED,
  HISTORY_LOGIN_REQUIRED,
  HISTORY_SESSION_EXPIRED,
} from '../api/history';

const sampleItem = {
  id: '1',
  processing_run_id: 10,
  created_at: '2026-09-01T15:04:00Z',
  job_title: 'Analista de Dados',
  company_name: 'Acme',
  job_summary: 'Vaga para dados',
  match_score: 72,
  strengths: ['SQL'],
  critical_gaps: ['Spark'],
  matching_skills: ['SQL'],
  missing_skills: ['Spark'],
  status: 'completed',
  generation_blocked: false,
  blocked_reason: null,
  source: 'processar',
};

describe('api.getGapHistory', () => {
  it('GET /users/me/gap-history envia Bearer e nunca X-User-Id', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://api.example.test${GAP_HISTORY_PATH}?limit=20&offset=0`,
      );
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
      expect(headers.get('X-User-Id')).toBeNull();
      expect(headers.get('x-user-id')).toBeNull();
      return new Response(
        JSON.stringify({ items: [sampleItem], limit: 20, offset: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    const result = await api.getGapHistory();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].job_title).toBe('Analista de Dados');
    expect(result.items[0].match_score).toBe(72);
    expect(result.limit).toBe(20);
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

    await expect(api.getGapHistory()).rejects.toMatchObject({
      status: 401,
      message: HISTORY_LOGIN_REQUIRED,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401 vira mensagem sem token, path ou dados de outro usuario', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail: 'Nao autenticado',
          items: [
            {
              id: 'other',
              job_title: 'Vaga de outra pessoa',
              match_score: 99,
            },
          ],
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
      await api.getGapHistory();
      throw new Error('esperava ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.message).toBe(HISTORY_SESSION_EXPIRED);
      expect(apiError.message).not.toContain('jwt-should-not-leak');
      expect(apiError.message).not.toContain(GAP_HISTORY_PATH);
      expect(apiError.message).not.toContain('Vaga de outra pessoa');
      expect(historyErrorLeaksInternals(apiError.message)).toBe(false);
    }
  });

  it('5xx nao vaza path interno nem URL da API', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail:
            'File "/app/main.py", line 12, in read_gap_history GET /users/me/gap-history',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl,
      getToken: () => 'jwt-should-not-leak',
    });

    await expect(api.getGapHistory()).rejects.toMatchObject({
      status: 500,
      message: HISTORY_LOAD_FAILED,
    });
  });

  it('rede cai sem vazar base URL', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = createApiClient({
      baseUrl: 'https://meu-agente-de-emprego.onrender.com',
      fetchImpl,
      getToken: () => 'jwt-memoria',
    });

    try {
      await api.getGapHistory();
      throw new Error('esperava ApiError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe(HISTORY_LOAD_FAILED);
      expect(apiError.message).not.toContain('onrender.com');
      expect(historyErrorLeaksInternals(apiError.message)).toBe(false);
    }
  });

  it('403 OUTDATED continua com detail.code para o ConsentGate', async () => {
    const onOutdated = vi.fn();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          detail: {
            code: 'TERMS_OUTDATED',
            message: 'Termos de uso desatualizados. Reaceite a versao vigente.',
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

    await expect(api.getGapHistory()).rejects.toMatchObject({
      status: 403,
      outdated: { code: 'TERMS_OUTDATED' },
    });
    expect(onOutdated).toHaveBeenCalled();
  });
});
