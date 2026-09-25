import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import {
  COVER_LETTER_COPY_FAILED,
  COVER_LETTER_COPY_SUCCESS,
  COVER_LETTER_FAILED,
  COVER_LETTER_MISSING_COMPANY,
  COVER_LETTER_QUOTA,
  coverLetterErrorLeaksInternals,
} from '../api/coverLetter';
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

const letterText = 'Ola, equipe da Acme.\nTenho interesse na vaga.\n\nAtenciosamente.';

const absolutePdfUrl =
  'https://cdn.evil.test/users/me/files/carta-acme.pdf?token=jwt-login';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function letterResponse(pdfUrl = absolutePdfUrl): Response {
  return jsonResponse({
    texto_resposta: letterText,
    pdf_url: pdfUrl,
    user_id: 'user-1',
  });
}

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  coverCalls: Array<{ url: string; init?: RequestInit }>;
  fileCalls: Array<{ url: string; init?: RequestInit }>;
};

function createHarness(options: {
  history?: unknown | (() => Response);
  me?: () => Response;
  coverLetter?: () => Response | Promise<Response>;
  file?: () => Response | Promise<Response>;
}): Harness {
  const coverCalls: Harness['coverCalls'] = [];
  const fileCalls: Harness['fileCalls'] = [];

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
    if (url.includes('/users/me/status')) {
      return jsonResponse(statusBody);
    }
    if (url.includes('/users/me/gap-history')) {
      if (typeof options.history === 'function') {
        return options.history();
      }
      return jsonResponse(
        options.history ?? { items: [historyItem], limit: 20, offset: 0 },
      );
    }
    if (url.includes('/users/me/cover-letter')) {
      coverCalls.push({ url, init });
      return options.coverLetter?.() ?? letterResponse();
    }
    if (url.includes('/users/me/files/')) {
      fileCalls.push({ url, init });
      return (
        options.file?.() ??
        new Response(new TextEncoder().encode('%PDF-1.4\ncarta'), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        })
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

  return { fetchImpl, coverCalls, fileCalls };
}

function authHeader(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('Authorization');
}

function hasUserIdHeader(init?: RequestInit): boolean {
  const headers = new Headers(init?.headers);
  return headers.get('X-User-Id') != null || headers.get('x-user-id') != null;
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

function renderApp(fetchImpl: Harness['fetchImpl'], initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <LocationProbe />
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByTestId('nav-historico')).toBeInTheDocument();
  });
  await user.click(screen.getByTestId('nav-historico'));
  await waitFor(() => {
    expect(screen.getByTestId('history-list')).toBeInTheDocument();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Feature: Carta de apresentacao a partir do historico', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('C1 gera a carta com loading, botao desabilitado e texto com quebras de linha', async () => {
    const gate = deferred<Response>();
    const harness = createHarness({
      coverLetter: () => gate.promise,
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);

    const button = screen.getByTestId('cover-letter-generate');
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-loading')).toHaveTextContent(
        'Gerando a carta de apresentacao...',
      );
    });
    expect(screen.getByTestId('cover-letter-generate')).toBeDisabled();
    expect(screen.getByTestId('cover-letter-generate')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    fireEvent.click(screen.getByTestId('cover-letter-generate'));
    expect(harness.coverCalls).toHaveLength(1);

    const call = harness.coverCalls[0];
    expect(call.url).toContain('/users/me/cover-letter');
    expect(call.url).not.toContain('jwt-login');
    expect(authHeader(call.init)).toBe('Bearer jwt-login');
    expect(hasUserIdHeader(call.init)).toBe(false);
    expect(JSON.parse(String(call.init?.body))).toEqual({ empresa: 'Acme' });
    expect(screen.getByTestId('history-list')).toBeInTheDocument();

    gate.resolve(letterResponse());

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-result')).toBeInTheDocument();
    });
    const text = screen.getByTestId('cover-letter-text');
    expect(text.textContent).toBe(letterText);
    expect(text.className).toContain('whitespace-pre-wrap');
    expect(screen.getByTestId('cover-letter-generate')).toBeEnabled();
    expect(screen.queryByTestId('cover-letter-loading')).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.activeElement).toBe(screen.getByTestId('cover-letter-result'));
  });

  it('C1 teclado: Enter no botao gera a carta', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);

    const button = screen.getByTestId('cover-letter-generate');
    button.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-text').textContent).toBe(letterText);
    });
    expect(harness.coverCalls).toHaveLength(1);
  });

  it('C2 copiar usa clipboard e anuncia sucesso ou falha', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('cover-letter-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-copy')).toBeInTheDocument();
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const live = screen.getByTestId('cover-letter-copy-status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    // fireEvent evita o stub de clipboard do user-event, que troca navigator.clipboard no clique.
    fireEvent.click(screen.getByTestId('cover-letter-copy'));
    await waitFor(() => {
      expect(live).toHaveTextContent(COVER_LETTER_COPY_SUCCESS);
    });
    expect(writeText).toHaveBeenCalledWith(letterText);

    writeText.mockRejectedValueOnce(new Error('negado'));
    fireEvent.click(screen.getByTestId('cover-letter-copy'));
    await waitFor(() => {
      expect(live).toHaveTextContent(COVER_LETTER_COPY_FAILED);
    });
  });

  it('C3 baixar PDF usa fetch autenticado, blob e revoga a object URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:carta-acme');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const hrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      hrefs.push(this.getAttribute('href') ?? this.href);
    });

    const harness = createHarness({
      coverLetter: () => letterResponse('/users/me/files/carta-acme.pdf'),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('cover-letter-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-download')).toBeEnabled();
    });

    expect(screen.getByTestId('cover-letter-result').querySelector('a')).toBeNull();
    await user.click(screen.getByTestId('cover-letter-download'));

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-download-success')).toHaveTextContent(
        'PDF da carta baixado.',
      );
    });
    expect(harness.fileCalls).toHaveLength(1);
    const fileCall = harness.fileCalls[0];
    expect(fileCall.url).toContain('/users/me/files/carta-acme.pdf');
    expect(fileCall.url).not.toContain('cdn.evil.test');
    expect(fileCall.url).not.toContain('token=');
    expect(fileCall.url).not.toContain('jwt-login');
    expect(authHeader(fileCall.init)).toBe('Bearer jwt-login');
    expect(hasUserIdHeader(fileCall.init)).toBe(false);
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:carta-acme');
    expect(hrefs.some((href) => href.includes('blob:carta-acme'))).toBe(true);
    expect(hrefs.some((href) => href.includes('/users/me/files/'))).toBe(false);
  });

  it('C4 erro 500 e rede mostram mensagem, tentar de novo e mantem o historico', async () => {
    let attempts = 0;
    const harness = createHarness({
      coverLetter: () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse(
            {
              detail:
                'File "/app/main.py" POST /users/me/cover-letter Bearer jwt-login https://meu-agente-de-emprego.onrender.com',
            },
            500,
          );
        }
        return letterResponse();
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('cover-letter-generate'));

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-error')).toBeInTheDocument();
    });
    const error = screen.getByTestId('cover-letter-error');
    expect(error).toHaveTextContent(COVER_LETTER_FAILED);
    expect(coverLetterErrorLeaksInternals(error.textContent ?? '')).toBe(false);
    expect(error.textContent).not.toContain('onrender.com');
    expect(error.textContent).not.toContain('jwt-login');
    expect(error.textContent).not.toContain('/users/me');
    expect(screen.getByTestId('history-list')).toBeInTheDocument();
    expect(screen.getByTestId('history-item-title')).toHaveTextContent(
      'Desenvolvedor Flutter',
    );
    expect(document.activeElement).toBe(error);

    await user.click(screen.getByTestId('cover-letter-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-text').textContent).toBe(letterText);
    });
    expect(screen.queryByTestId('cover-letter-error')).not.toBeInTheDocument();
    expect(harness.coverCalls).toHaveLength(2);
    expect(screen.getByTestId('history-page')).toBeInTheDocument();
  });

  it('C4 rede sem URL na mensagem e com tentar de novo', async () => {
    const harness = createHarness({
      coverLetter: () => {
        throw new TypeError(
          'Failed to fetch https://meu-agente-de-emprego.onrender.com/users/me/cover-letter',
        );
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('cover-letter-generate'));

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-error')).toHaveTextContent(
        COVER_LETTER_FAILED,
      );
    });
    const errorText = screen.getByTestId('cover-letter-error').textContent ?? '';
    expect(errorText).not.toContain('onrender.com');
    expect(errorText).not.toContain('cover-letter');
    expect(coverLetterErrorLeaksInternals(errorText)).toBe(false);
    expect(screen.getByTestId('cover-letter-retry')).toHaveTextContent(
      'Tentar de novo',
    );
    expect(screen.getByTestId('history-list')).toBeInTheDocument();
  });

  it('C5 sem empresa desabilita o botao, mostra a dica e nao chama a API', async () => {
    const harness = createHarness({
      history: {
        items: [
          historyItem,
          {
            ...historyItem,
            id: '2',
            job_title: 'Analise sem empresa',
            company_name: '   ',
          },
          {
            ...historyItem,
            id: '3',
            job_title: 'Outra sem empresa',
            company_name: null,
          },
        ],
        limit: 20,
        offset: 0,
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);

    const cards = screen.getAllByTestId('history-item');
    expect(cards).toHaveLength(3);
    const missing = within(cards[1]).getByTestId('cover-letter-generate');
    const hint = within(cards[1]).getByTestId('cover-letter-missing-company');
    expect(missing).toBeDisabled();
    expect(hint).toHaveTextContent(COVER_LETTER_MISSING_COMPANY);
    expect(missing).toHaveAttribute('aria-describedby', hint.id);
    fireEvent.click(missing);
    expect(harness.coverCalls).toHaveLength(0);

    const nullCompany = within(cards[2]).getByTestId('cover-letter-generate');
    expect(nullCompany).toBeDisabled();
    fireEvent.click(nullCompany);
    expect(harness.coverCalls).toHaveLength(0);

    await user.click(within(cards[0]).getByTestId('cover-letter-generate'));
    await waitFor(() => {
      expect(harness.coverCalls).toHaveLength(1);
    });
    expect(JSON.parse(String(harness.coverCalls[0].init?.body))).toEqual({
      empresa: 'Acme',
    });
  });

  it('C6 402 e 429 mostram limite sem CTA de pagamento', async () => {
    for (const status of [402, 429]) {
      cleanup();
      const harness = createHarness({
        coverLetter: () =>
          jsonResponse(
            {
              detail: {
                code: 'SUBSCRIPTION_REQUIRED',
                message:
                  'Assine o plano Essencial. Pagar em https://billing.example/checkout',
                used: 5,
                limit: 5,
              },
            },
            status,
          ),
      });
      const user = userEvent.setup();
      renderApp(harness.fetchImpl);
      await login(user);
      await openHistory(user);
      await user.click(screen.getByTestId('cover-letter-generate'));

      await waitFor(() => {
        expect(screen.getByTestId('cover-letter-quota')).toBeInTheDocument();
      });
      const quota = screen.getByTestId('cover-letter-quota');
      expect(quota).toHaveTextContent(COVER_LETTER_QUOTA);
      expect(quota.textContent?.toLowerCase()).not.toMatch(
        /assin|pagar|pagamento|stripe|checkout|upgrade/,
      );
      expect(quota.querySelector('a')).toBeNull();
      expect(quota.querySelector('button')).toBeNull();
      expect(coverLetterErrorLeaksInternals(quota.textContent ?? '')).toBe(false);
      expect(screen.queryByTestId('cover-letter-result')).not.toBeInTheDocument();
      expect(screen.getByTestId('history-list')).toBeInTheDocument();
      expect(window.localStorage.length).toBe(0);
      cleanup();
    }
  });

  it('C7 sem auth redireciona para o login e nao chama a carta', () => {
    const guest = createHarness({});
    renderApp(guest.fetchImpl, '/historico');
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/');
    expect(screen.getByTestId('auth-tab-login')).toBeInTheDocument();
    expect(screen.queryByTestId('history-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cover-letter-generate')).not.toBeInTheDocument();
    expect(
      guest.fetchImpl.mock.calls.some(([input]) =>
        String(input).includes('/users/me/cover-letter'),
      ),
    ).toBe(false);
    expect(
      guest.fetchImpl.mock.calls.some(([, init]) => {
        const auth = authHeader(init);
        return auth === 'Bearer' || auth === 'Bearer ' || auth === 'Bearer null';
      }),
    ).toBe(false);
  });

  it('401 na carta volta ao login', async () => {
    const harness = createHarness({
      coverLetter: () =>
        jsonResponse(
          { detail: 'Bearer jwt-login expirado em /users/me/cover-letter' },
          401,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('cover-letter-generate'));

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/');
    });
    expect(screen.getByTestId('auth-tab-login')).toBeInTheDocument();
    expect(screen.queryByTestId('cover-letter-error')).not.toBeInTheDocument();
    expect(screen.queryByText(/jwt-login/)).not.toBeInTheDocument();
  });

  it('403 termos desatualizados abre o ConsentGate', async () => {
    const harness = createHarness({
      coverLetter: () =>
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
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('cover-letter-generate'));

    await waitFor(() => {
      expect(screen.getByTestId('consent-gate')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('cover-letter-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cover-letter-result')).not.toBeInTheDocument();
  });
});
