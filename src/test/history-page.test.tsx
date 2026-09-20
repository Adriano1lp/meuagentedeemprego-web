import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import {
  historyErrorLeaksInternals,
  HISTORY_LOAD_FAILED,
  HISTORY_SESSION_EXPIRED,
} from '../api/history';
import { AuthProvider } from '../auth/AuthContext';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

const statusBody = {
  user_id: 'user-1',
  has_cv: true,
  has_profile: true,
  has_embeddings: true,
  generated_files: 1,
  plan: 'free',
  used: 1,
  limit: 5,
  remaining: 4,
  period: '2026-09',
};

const historyItem = {
  id: '1',
  processing_run_id: 10,
  created_at: '2026-09-01T15:04:00Z',
  job_title: 'Desenvolvedor Flutter',
  company_name: 'Acme',
  job_summary: 'Vaga remota com Dart',
  match_score: 88,
  strengths: ['Dart'],
  critical_gaps: ['K8s'],
  matching_skills: ['Dart'],
  missing_skills: ['K8s'],
  status: 'completed',
  generation_blocked: false,
  blocked_reason: null,
  source: 'processar',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  historyCalls: string[];
};

function createHarness(options: {
  history?: unknown | (() => Response);
  me?: () => Response;
  initialPath?: string;
}): Harness {
  const historyCalls: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/login')) {
      return jsonResponse({
        access_token: 'jwt-login',
        token_type: 'bearer',
        user: userBody,
      });
    }
    if (url.includes('/auth/me')) {
      return options.me?.() ?? jsonResponse(userBody);
    }
    if (url.includes('/users/me/status')) {
      return jsonResponse(statusBody);
    }
    if (url.includes('/users/me/gap-history')) {
      historyCalls.push(url);
      if (typeof options.history === 'function') {
        return options.history();
      }
      return jsonResponse(
        options.history ?? { items: [historyItem], limit: 20, offset: 0 },
      );
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });

  return { fetchImpl, historyCalls };
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
}

function renderApp(
  fetchImpl: Harness['fetchImpl'],
  initialPath = '/',
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Historico — BDD', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. logado + 200 com items → lista com titulo, empresa, score e data', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('home-shell')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('nav-historico'));
    await waitFor(() => {
      expect(screen.getByTestId('history-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('history-item-title')).toHaveTextContent(
      'Desenvolvedor Flutter',
    );
    expect(screen.getByTestId('history-item-company')).toHaveTextContent('Acme');
    expect(screen.getByTestId('history-item-score')).toHaveTextContent(
      'Aderencia: 88/100',
    );
    expect(screen.getByTestId('history-item-date')).toHaveAttribute(
      'datetime',
      '2026-09-01T15:04:00Z',
    );
    expect(screen.getByTestId('history-item-date')).toHaveTextContent(
      '01/09/2026 15:04',
    );
    expect(screen.queryByTestId('history-empty')).not.toBeInTheDocument();
    expect(
      harness.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/users/me/gap-history'),
      ),
    ).toBe(true);
    expect(
      harness.fetchImpl.mock.calls.some(([, init]) => {
        const headers = new Headers(init?.headers);
        return headers.get('X-User-Id') != null;
      }),
    ).toBe(false);
    expect(window.localStorage.getItem('access_token')).toBeNull();
    expect(window.sessionStorage.getItem('access_token')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('2. logado + 200 [] → estado vazio claro', async () => {
    const harness = createHarness({ history: { items: [] } });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('home-shell')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-historico'));
    await waitFor(() => {
      expect(screen.getByTestId('history-empty')).toHaveTextContent(
        'Nenhum retorno salvo ainda.',
      );
    });
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-item')).not.toBeInTheDocument();
  });

  it('3. 401/403 → erro legivel e nunca dados de outro usuario', async () => {
    const otherUserItem = {
      id: 'other',
      job_title: 'Vaga de outra pessoa',
      company_name: 'Outra Corp',
      match_score: 99,
      created_at: '2026-01-01T00:00:00Z',
    };

    const unauthorized = createHarness({
      history: () =>
        jsonResponse(
          { detail: 'Nao autenticado', items: [otherUserItem] },
          401,
        ),
    });
    const user = userEvent.setup();
    renderApp(unauthorized.fetchImpl);
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('nav-historico')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-historico'));
    await waitFor(() => {
      expect(screen.getByTestId('history-error')).toHaveTextContent(
        HISTORY_SESSION_EXPIRED,
      );
    });
    expect(screen.queryByText('Vaga de outra pessoa')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument();

    cleanup();

    const forbidden = createHarness({
      history: () =>
        jsonResponse(
          { detail: 'Forbidden', items: [otherUserItem] },
          403,
        ),
    });
    const user2 = userEvent.setup();
    renderApp(forbidden.fetchImpl);
    await login(user2);
    await waitFor(() => {
      expect(screen.getByTestId('nav-historico')).toBeInTheDocument();
    });
    await user2.click(screen.getByTestId('nav-historico'));
    await waitFor(() => {
      expect(screen.getByTestId('history-error')).toHaveTextContent(
        'Nao foi possivel carregar o historico.',
      );
    });
    expect(screen.queryByText('Vaga de outra pessoa')).not.toBeInTheDocument();
    expect(screen.queryByText('Outra Corp')).not.toBeInTheDocument();
  });

  it('4. 5xx/rede → erro sanitizado sem path, token ou stack', async () => {
    const harness = createHarness({
      history: () =>
        jsonResponse(
          {
            detail:
              'File "/app/main.py", line 12, in read_gap_history GET /users/me/gap-history Bearer jwt-abc',
          },
          500,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('nav-historico')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-historico'));
    await waitFor(() => {
      expect(screen.getByTestId('history-error')).toHaveTextContent(
        HISTORY_LOAD_FAILED,
      );
    });
    const errorText = screen.getByTestId('history-error').textContent ?? '';
    expect(errorText).not.toContain('/users/me/gap-history');
    expect(errorText).not.toContain('onrender.com');
    expect(errorText).not.toContain('jwt-abc');
    expect(errorText).not.toContain('main.py');
    expect(errorText).not.toContain('Bearer');
    expect(historyErrorLeaksInternals(errorText)).toBe(false);
  });

  it('5. sem JWT mostra login e nao chama a API', () => {
    const guest = createHarness({});
    renderApp(guest.fetchImpl, '/historico');
    expect(screen.getByTestId('auth-tab-login')).toBeInTheDocument();
    expect(screen.queryByTestId('history-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument();
    expect(
      guest.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/users/me/gap-history'),
      ),
    ).toBe(false);
  });

  it('403 OUTDATED abre ConsentGate e nao lista historico', async () => {
    const outdated = createHarness({
      me: () =>
        jsonResponse(
          {
            detail: {
              code: 'TERMS_OUTDATED',
              message: 'Termos de uso desatualizados. Reaceite a versao vigente.',
            },
          },
          403,
        ),
    });
    const user = userEvent.setup();
    renderApp(outdated.fetchImpl, '/historico');
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('consent-gate')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument();
    expect(
      outdated.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/users/me/gap-history'),
      ),
    ).toBe(false);
  });
});
