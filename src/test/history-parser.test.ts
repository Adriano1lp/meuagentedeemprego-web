import { describe, expect, it } from 'vitest';

import {
  buildGapHistoryPath,
  extractGapHistoryItems,
  formatHistoryDate,
  GAP_HISTORY_PATH,
  historyErrorLeaksInternals,
  HISTORY_LOAD_FAILED,
  HISTORY_LOGIN_REQUIRED,
  HISTORY_SESSION_EXPIRED,
  parseGapHistoryItem,
  parseGapHistoryResponse,
  safeHistoryErrorMessage,
} from '../api/history';
import { ApiError } from '../api/client';

describe('parseGapHistoryResponse', () => {
  it('mapeia items da API e ignora linhas invalidas', () => {
    const result = parseGapHistoryResponse({
      items: [
        {
          id: 42,
          processing_run_id: 10,
          job_title: 'Desenvolvedor Flutter',
          company_name: 'Acme',
          job_summary: 'Vaga para app mobile',
          match_score: 81,
          strengths: ['Dart', 'Riverpod'],
          critical_gaps: ['Kubernetes'],
          matching_skills: ['Dart'],
          missing_skills: ['K8s'],
          status: 'completed',
          generation_blocked: false,
          blocked_reason: null,
          source: 'processar',
          created_at: '2026-09-01T15:04:00Z',
        },
        { job_title: 'sem id' },
        'nao-e-mapa',
        {
          insight_id: 'mongo-1',
          job_title: 'QA',
          match_score: '70',
          created_at: '2026-08-20T10:00:00.000Z',
        },
      ],
      limit: 20,
      offset: 0,
    });

    expect(result.items).toHaveLength(2);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.items[0]).toMatchObject({
      id: '42',
      processing_run_id: 10,
      job_title: 'Desenvolvedor Flutter',
      company_name: 'Acme',
      match_score: 81,
      strengths: ['Dart', 'Riverpod'],
      critical_gaps: ['Kubernetes'],
      source: 'processar',
    });
    expect(result.items[1].id).toBe('mongo-1');
    expect(result.items[1].match_score).toBe(70);
  });

  it('resposta vazia, lista nua ou sem items vira lista vazia', () => {
    expect(parseGapHistoryResponse(null).items).toEqual([]);
    expect(parseGapHistoryResponse({ limit: 20 }).items).toEqual([]);
    expect(parseGapHistoryResponse({ items: [] }).items).toEqual([]);
    expect(parseGapHistoryResponse([]).items).toEqual([]);
    expect(extractGapHistoryItems([])).toEqual([]);
  });

  it('rejeita item sem id/insight_id', () => {
    expect(parseGapHistoryItem({ job_title: 'x' })).toBeNull();
    expect(parseGapHistoryItem(null)).toBeNull();
  });
});

describe('buildGapHistoryPath / formatHistoryDate', () => {
  it('monta query com limit 1-100 e offset >= 0', () => {
    expect(buildGapHistoryPath()).toBe(`${GAP_HISTORY_PATH}?limit=20&offset=0`);
    expect(buildGapHistoryPath({ limit: 50, offset: 10 })).toBe(
      `${GAP_HISTORY_PATH}?limit=50&offset=10`,
    );
    expect(buildGapHistoryPath({ limit: 0, offset: -4 })).toBe(
      `${GAP_HISTORY_PATH}?limit=1&offset=0`,
    );
    expect(buildGapHistoryPath({ limit: 500 })).toBe(
      `${GAP_HISTORY_PATH}?limit=100&offset=0`,
    );
  });

  it('formata created_at em UTC sem vazar ISO cru no label', () => {
    expect(formatHistoryDate('2026-09-01T15:04:00Z')).toBe(
      '01/09/2026 15:04',
    );
    expect(formatHistoryDate(undefined)).toBeNull();
    expect(formatHistoryDate('nao-e-data')).toBeNull();
  });
});

describe('safeHistoryErrorMessage', () => {
  it('401 vira sessao expirada; sem JWT vira login; 5xx fica generico', () => {
    expect(
      safeHistoryErrorMessage(new ApiError(401, { detail: 'Nao autenticado' }, 'Nao autenticado')),
    ).toBe(HISTORY_SESSION_EXPIRED);
    expect(
      safeHistoryErrorMessage(
        new ApiError(401, null, HISTORY_LOGIN_REQUIRED),
      ),
    ).toBe(HISTORY_LOGIN_REQUIRED);
    expect(
      safeHistoryErrorMessage(
        new ApiError(
          500,
          {
            detail:
              'File "/app/main.py", line 12, in read_gap_history GET /users/me/gap-history',
          },
          'File "/app/main.py" GET /users/me/gap-history Bearer jwt-abc',
        ),
      ),
    ).toBe(HISTORY_LOAD_FAILED);
  });

  it('nao devolve URL, path ou token', () => {
    const message = safeHistoryErrorMessage(
      new Error(
        'HTTP 500: File "/app/main.py" GET /users/me/gap-history https://meu-agente-de-emprego.onrender.com Bearer jwt-abc',
      ),
    );
    expect(message).toBe(HISTORY_LOAD_FAILED);
    expect(historyErrorLeaksInternals(message)).toBe(false);
    expect(
      historyErrorLeaksInternals(
        'GET /users/me/gap-history Bearer jwt-secret',
      ),
    ).toBe(true);
  });
});
