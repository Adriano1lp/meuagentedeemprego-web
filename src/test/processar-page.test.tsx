import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';

const pdfUrl =
  'https://meu-agente-de-emprego.onrender.com/users/me/files/abc-123.pdf';

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
  subscription_status: 'none',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pdfResponse(text = '%PDF-1.4\n%mae'): Response {
  return new Response(new TextEncoder().encode(text), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });
}

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  statusPayloads: unknown[];
  processarCalls: string[];
  fileCalls: string[];
};

function createHarness(options: {
  status?: unknown | (() => unknown);
  billing?: unknown | (() => unknown);
  processar?: (texto: string) => Response;
  file?: () => Response;
  me?: () => Response;
}): Harness {
  const statusPayloads: unknown[] = [];
  const processarCalls: string[] = [];
  const fileCalls: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    if (url.includes('/billing/me')) {
      if (options.billing) {
        const payload =
          typeof options.billing === 'function' ? options.billing() : options.billing;
        return jsonResponse(payload);
      }
      const payload =
        typeof options.status === 'function' ? options.status() : options.status;
      const body = (payload ?? statusBody) as Record<string, unknown>;
      return jsonResponse({
        plan: body.plan,
        subscription_status: body.subscription_status,
        used: body.used,
        limit: body.limit,
        remaining: body.remaining,
        period: body.period,
        period_end: body.period_end,
      });
    }
    if (url.includes('/users/me/status')) {
      const payload =
        typeof options.status === 'function' ? options.status() : options.status;
      const body = payload ?? statusBody;
      statusPayloads.push(body);
      return jsonResponse(body);
    }
    if (url.endsWith('/processar')) {
      const payload = JSON.parse(String(init?.body)) as { texto?: string };
      processarCalls.push(payload.texto ?? '');
      return (
        options.processar?.(payload.texto ?? '') ??
        jsonResponse({
          texto_resposta: 'Analise ok',
          pdf_url: pdfUrl,
          match_score: 80,
          pdf_generated: true,
          generation_blocked: false,
        })
      );
    }
    if (url.includes('/users/me/files/')) {
      fileCalls.push(url);
      return options.file?.() ?? pdfResponse();
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });

  return { fetchImpl, statusPayloads, processarCalls, fileCalls };
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await waitFor(() => {
    expect(screen.getByTestId('home-shell')).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(screen.getByTestId('processar-panel')).toBeInTheDocument();
  });
}

function renderApp(fetchImpl: Harness['fetchImpl']) {
  return render(
    <MemoryRouter initialEntries={['/entrar']}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('HomePage processar + cotas', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. UI de cota reflete GET /billing/me sem calcular remaining', async () => {
    const harness = createHarness({
      status: {
        ...statusBody,
        used: 9,
        remaining: 1,
        plan: 'free',
        limit: 5,
      },
      billing: {
        plan: 'essencial',
        used: 2,
        limit: 30,
        remaining: 28,
        period: '2026-10',
        period_end: '2026-11-01T00:00:00Z',
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);

    await waitFor(() => {
      expect(screen.getByTestId('status-plan')).toHaveTextContent('Essencial');
    });
    expect(screen.getByTestId('status-quota')).toHaveTextContent(
      '2 de 30 análises usadas',
    );
    expect(screen.getByTestId('status-quota')).not.toHaveTextContent('28');
    expect(screen.getByTestId('quota-reset')).toHaveTextContent(
      'Sua cota reinicia em 1º de novembro',
    );
    expect(screen.queryByText(/restantes/)).not.toBeInTheDocument();
    expect(
      harness.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/billing/me'),
      ),
    ).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it('2. sucesso de processar oferece PDF autenticado %PDF e refresca status', async () => {
    let used = 1;
    const harness = createHarness({
      status: () => ({ ...statusBody, used, remaining: 5 - used }),
    });
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:pdf');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderApp(harness.fetchImpl);
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('status-quota')).toHaveTextContent(
        '1 de 5 análises usadas',
      );
    });

    await user.type(
      screen.getByTestId('processar-texto'),
      'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
    );
    used = 2;
    await user.click(screen.getByTestId('processar-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('processar-success')).toBeInTheDocument();
    });
    expect(screen.getByTestId('download-pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('processar-blocked')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('download-pdf'));
    await waitFor(() => {
      expect(screen.getByTestId('pdf-download-success')).toBeInTheDocument();
    });
    expect(harness.fileCalls.some((url) => url.includes('/users/me/files/abc-123.pdf'))).toBe(
      true,
    );
    await waitFor(() => {
      expect(screen.getByTestId('status-quota')).toHaveTextContent(
        '2 de 5 análises usadas',
      );
    });
    expect(harness.statusPayloads.length).toBeGreaterThan(1);
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('3. generation_blocked nao mostra link de PDF', async () => {
    const harness = createHarness({
      processar: () =>
        jsonResponse({
          texto_resposta: 'Aderencia baixa',
          pdf_url: null,
          match_score: 18,
          pdf_generated: false,
          generation_blocked: true,
          blocked_reason: 'low_match_score',
        }),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);

    await user.type(
      screen.getByTestId('processar-texto'),
      'Vaga para estagio com requisitos e responsabilidades.',
    );
    await user.click(screen.getByTestId('processar-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('processar-blocked')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('download-pdf')).not.toBeInTheDocument();
    expect(screen.queryByTestId('processar-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pdf-download-success')).not.toBeInTheDocument();
    expect(harness.fileCalls).toEqual([]);
  });

  it('4. 402 mostra bloqueio, sem loop de retry e sem queimar cota local', async () => {
    const harness = createHarness({
      processar: () =>
        jsonResponse(
          {
            detail: {
              code: 'SUBSCRIPTION_REQUIRED',
              message: 'Cota gratuita do mes esgotada.',
              used: 5,
              limit: 5,
              plan: 'free',
            },
          },
          402,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('status-quota')).toHaveTextContent(
        '1 de 5 análises usadas',
      );
    });

    await user.type(
      screen.getByTestId('processar-texto'),
      'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
    );
    await user.click(screen.getByTestId('processar-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('quota-block')).toHaveTextContent(
        'Cota gratuita do mes esgotada.',
      );
    });
    expect(screen.queryByTestId('processar-success')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-quota')).toHaveTextContent(
      '1 de 5 análises usadas',
    );
    expect(harness.processarCalls).toHaveLength(1);
    expect(window.localStorage.length).toBe(0);
  });

  it('5. 400 mostra erro e nao UI de consumo/sucesso', async () => {
    const harness = createHarness({
      processar: () =>
        jsonResponse(
          {
            detail:
              'Embeddings do usuario nao encontrados. Envie o curriculo e execute POST /users/me/rebuild-embeddings antes de processar a vaga.',
          },
          400,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);

    await user.type(
      screen.getByTestId('processar-texto'),
      'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
    );
    await user.click(screen.getByTestId('processar-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('processar-error')).toHaveTextContent(
        'Não foi possível analisar a vaga.',
      );
      expect(screen.getByTestId('processar-error').textContent).not.toMatch(
        /\/users\/|POST |has_cv|Bearer/,
      );
    });
    expect(screen.queryByTestId('processar-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('download-pdf')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-quota')).toHaveTextContent(
      '1 de 5 análises usadas',
    );
  });

  it('6a. sem JWT nao acessa status/processar', async () => {
    const guest = createHarness({});
    renderApp(guest.fetchImpl);
    expect(await screen.findByTestId('auth-tab-login')).toBeInTheDocument();
    expect(screen.queryByTestId('status-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('processar-submit')).not.toBeInTheDocument();
    expect(
      guest.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/users/me/status'),
      ),
    ).toBe(false);
  });

  it('6b. 403 OUTDATED nao acessa status/processar (gate W1)', async () => {
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
    renderApp(outdated.fetchImpl);
    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('consent-gate')).toBeInTheDocument();
    });
    expect(
      outdated.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/users/me/status'),
      ),
    ).toBe(false);
    expect(
      outdated.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/processar'),
      ),
    ).toBe(false);
  });
});
