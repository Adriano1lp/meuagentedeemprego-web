import { describe, expect, it } from 'vitest';

import {
  buildGapHistoryPath,
  extractGapHistoryItems,
  formatHistoryDate,
  GAP_HISTORY_PATH,
  historyCvFileName,
  historyDownloadErrorLeaksInternals,
  historyErrorLeaksInternals,
  historyJobPdfFileName,
  HISTORY_CV_DOWNLOAD_FAILED,
  HISTORY_LOAD_FAILED,
  HISTORY_LOGIN_REQUIRED,
  HISTORY_SESSION_EXPIRED,
  parseGapHistoryItem,
  parseGapHistoryResponse,
  safeHistoryDownloadMessage,
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
      cv_file_name: null,
      pdf_url: null,
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

  it('tipa cv_file_name e pdf_url e trata ausencia como null', () => {
    const withFiles = parseGapHistoryItem({
      id: '1',
      match_score: 10,
      cv_file_name: ' cv-acme.pdf ',
      pdf_url: '/users/me/files/vaga-acme.pdf',
    });
    expect(withFiles?.cv_file_name).toBe('cv-acme.pdf');
    expect(withFiles?.pdf_url).toBe('/users/me/files/vaga-acme.pdf');

    for (const cvFileName of [null, '', '   ', undefined]) {
      const item = parseGapHistoryItem({
        id: '2',
        cv_file_name: cvFileName,
        pdf_url: null,
      });
      expect(item?.cv_file_name).toBeNull();
      expect(item?.pdf_url).toBeNull();
    }

    const missing = parseGapHistoryItem({ id: '3', job_title: 'Sem arquivo' });
    expect(missing?.cv_file_name).toBeNull();
    expect(missing?.pdf_url).toBeNull();
    expect(historyCvFileName('/users/me/files/cv-acme.pdf?token=jwt-abc')).toBe(
      'cv-acme.pdf',
    );
    expect(historyCvFileName('..')).toBeNull();
    expect(historyCvFileName('.')).toBeNull();
  });

  it('pdf_url da vaga so vira arquivo quando nao esta bloqueado', () => {
    expect(
      historyJobPdfFileName({
        pdf_url: '/users/me/files/vaga.pdf',
        generation_blocked: false,
      }),
    ).toBe('vaga.pdf');
    expect(
      historyJobPdfFileName({
        pdf_url: 'https://cdn.evil.test/users/me/files/vaga.pdf?token=jwt-abc',
        generation_blocked: false,
      }),
    ).toBe('vaga.pdf');
    expect(
      historyJobPdfFileName({
        pdf_url: '/users/me/files/vaga.pdf',
        generation_blocked: true,
      }),
    ).toBeNull();
    expect(
      historyJobPdfFileName({ pdf_url: null, generation_blocked: false }),
    ).toBeNull();
    expect(
      historyJobPdfFileName({
        pdf_url: 'https://cdn.evil.test/other/vaga.pdf',
        generation_blocked: false,
      }),
    ).toBeNull();
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

  it('download 401/404/5xx nao devolve path, URL ou token', () => {
    const leaked =
      'File "/app/main.py" GET /users/me/files/cv-acme.pdf Bearer jwt-abc https://meu-agente-de-emprego.onrender.com';
    expect(
      safeHistoryDownloadMessage(
        new ApiError(401, { detail: leaked }, leaked),
        HISTORY_CV_DOWNLOAD_FAILED,
      ),
    ).toBe(HISTORY_SESSION_EXPIRED);
    for (const status of [404, 500, 0]) {
      const message = safeHistoryDownloadMessage(
        new ApiError(status, { detail: leaked }, leaked),
        HISTORY_CV_DOWNLOAD_FAILED,
      );
      expect(message).toBe(HISTORY_CV_DOWNLOAD_FAILED);
      expect(historyDownloadErrorLeaksInternals(message)).toBe(false);
      expect(message).not.toContain('cv-acme.pdf');
      expect(message).not.toContain('jwt-abc');
    }
    const html = safeHistoryDownloadMessage(
      new ApiError(
        500,
        '<html><script>Bearer jwt-abc</script>',
        '<html><script>Bearer jwt-abc</script>\n    at read_file (/app/main.py:12)',
      ),
      HISTORY_CV_DOWNLOAD_FAILED,
    );
    expect(html).toBe(HISTORY_CV_DOWNLOAD_FAILED);
    expect(historyDownloadErrorLeaksInternals(html)).toBe(false);
    expect(html).not.toContain('<');
    expect(
      historyDownloadErrorLeaksInternals(
        '<html>GET /users/me/files/cv.pdf Bearer jwt-abc\n    at boom',
      ),
    ).toBe(true);
  });
});
