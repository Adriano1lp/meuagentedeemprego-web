import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import {
  COVER_LETTER_COMPANY_REQUIRED,
  COVER_LETTER_CV_GUIDANCE,
  COVER_LETTER_FAILED,
  COVER_LETTER_RATE_LIMIT,
  COVER_LETTER_STATUS_CHECK_FAILED,
} from '../api/coverLetter';
import { AuthProvider } from '../auth/AuthContext';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

const letterText = 'Ola, equipe da Acme.\nTenho interesse na vaga.\n\nAtenciosamente.';

const secretFields = {
  cv_file: 'cv-secreto.pdf',
  original_file: 'original-secreto.pdf',
  object_key: 'objeto-secreto',
  chroma_dir: 'chroma-secreto',
  vector_store: 'vetor-secreto',
  extracted_text_object_key: 'texto-secreto',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  coverCalls: Array<{ url: string; init?: RequestInit }>;
  fileCalls: Array<{ url: string; init?: RequestInit }>;
  embeddings: { ready: boolean };
};

function createHarness(options: {
  embeddings?: boolean;
  status?: () => Response;
  coverLetter?: () => Response | Promise<Response>;
} = {}): Harness {
  const coverCalls: Harness['coverCalls'] = [];
  const fileCalls: Harness['fileCalls'] = [];
  const embeddings = { ready: options.embeddings ?? true };

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/auth/login')) {
      return jsonResponse({
        access_token: 'jwt-login',
        token_type: 'bearer',
        user: userBody,
      });
    }
    if (url.includes('/auth/me') || /\/users\/me(\?|$)/.test(url)) {
      return jsonResponse(userBody);
    }
    if (url.includes('/users/me/status')) {
      return (
        options.status?.() ??
        jsonResponse({
          user_id: 'user-1',
          has_cv: true,
          has_profile: true,
          has_embeddings: embeddings.ready,
          plan: 'free',
        })
      );
    }
    if (url.includes('/billing/me')) {
      return jsonResponse({
        plan: 'free',
        subscription_status: 'none',
        used: 1,
        limit: 5,
        remaining: 4,
        period: '2026-09',
      });
    }
    if (url.includes('/users/me/cover-letter')) {
      coverCalls.push({ url, init });
      return (
        options.coverLetter?.() ??
        jsonResponse({
          texto_resposta: letterText,
          pdf_url: '/users/me/files/carta-acme.pdf',
          user_id: 'user-1',
          ...secretFields,
        })
      );
    }
    if (url.includes('/users/me/files/')) {
      fileCalls.push({ url, init });
      return new Response(new TextEncoder().encode('%PDF-1.4\ncarta'), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    if (method === 'POST' && url.includes('/processar')) {
      return jsonResponse({ detail: 'nao deveria analisar' }, 500);
    }
    return jsonResponse({ detail: 'ausente' }, 404);
  });

  return { fetchImpl, coverCalls, fileCalls, embeddings };
}

function renderApp(fetchImpl: Harness['fetchImpl'], initialPath = '/entrar') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
}

async function openCarta(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByTestId('shortcut-carta')).toHaveAttribute('href', '/app/carta');
  });
  await user.click(screen.getByTestId('shortcut-carta'));
  expect(await screen.findByTestId('carta-page')).toBeInTheDocument();
}

function companyField() {
  return screen.getByTestId('cover-letter-company');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function storedDump(): string {
  const local = Array.from({ length: window.localStorage.length }, (_, index) => {
    const key = window.localStorage.key(index) ?? '';
    return `${key}=${window.localStorage.getItem(key) ?? ''}`;
  }).join('\n');
  const session = Array.from({ length: window.sessionStorage.length }, (_, index) => {
    const key = window.sessionStorage.key(index) ?? '';
    return `${key}=${window.sessionStorage.getItem(key) ?? ''}`;
  }).join('\n');
  return `${local}\n${session}`;
}

function expectNoSecrets(text: string) {
  expect(text).not.toMatch(
    /cv_file|original_file|object_key|chroma_dir|vector_store|extracted_text_object_key|cv-secreto|objeto-secreto|chroma-secreto|vetor-secreto|texto-secreto/i,
  );
  expect(text).not.toMatch(/jwt-login|access_token/i);
}

describe('Carta avulsa só com a empresa', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('empresa vazia ou só espaços não envia e avisa no campo', async () => {
    const harness = createHarness();
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);

    const input = companyField();
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.queryByLabelText(/cargo/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('cover-letter-generate')).toBeDisabled();

    fireEvent.click(screen.getByTestId('cover-letter-generate'));
    input.focus();
    await user.keyboard('{Enter}');

    const error = await screen.findByTestId('cover-letter-company-error');
    expect(error).toHaveTextContent(COVER_LETTER_COMPANY_REQUIRED);
    expect(error).toHaveAttribute('aria-live', 'polite');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
    await waitFor(() => {
      expect(document.activeElement).toBe(error);
    });
    expect(harness.coverCalls).toHaveLength(0);

    await user.type(input, '   ');
    expect(screen.getByTestId('cover-letter-generate')).toBeDisabled();
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(harness.coverCalls).toHaveLength(0);
    expect(companyField()).toHaveValue('   ');
  });

  it('sem embeddings não gera, orienta o CV e não chama o POST', async () => {
    const harness = createHarness({ embeddings: false });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);

    const gate = await screen.findByTestId('cover-letter-cv-gate');
    expect(gate).toHaveTextContent(COVER_LETTER_CV_GUIDANCE);
    expect(gate).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('cover-letter-cv-link')).toHaveAttribute('href', '/app/curriculo');
    expect(gate.textContent).not.toMatch(/embedding|rebuild|\/users\/me|chroma|object_key/i);

    await user.type(companyField(), 'Acme');
    const button = screen.getByTestId('cover-letter-generate');
    expect(button).toBeDisabled();
    expect(button.getAttribute('aria-describedby')).toContain(gate.id);
    fireEvent.click(button);
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    expect(harness.coverCalls).toHaveLength(0);
    expect(
      harness.fetchImpl.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/users/me/cover-letter') &&
          (init?.method ?? 'GET') === 'POST',
      ),
    ).toBe(false);
    expect(companyField()).toHaveValue('Acme');

    await user.click(screen.getByTestId('cover-letter-cv-link'));
    expect(await screen.findByTestId('curriculo-page')).toBeInTheDocument();
    expect(harness.coverCalls).toHaveLength(0);
  });

  it('se o status mudar antes do clique, o POST não sai', async () => {
    const harness = createHarness({ embeddings: true });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);
    await user.type(companyField(), 'Acme');
    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-generate')).toBeEnabled();
    });

    harness.embeddings.ready = false;
    await user.click(screen.getByTestId('cover-letter-generate'));

    expect(await screen.findByTestId('cover-letter-cv-gate')).toHaveTextContent(
      COVER_LETTER_CV_GUIDANCE,
    );
    expect(harness.coverCalls).toHaveLength(0);
    expect(companyField()).toHaveValue('Acme');
  });

  it('gera com a empresa aparada, mostra o texto e baixa o PDF', async () => {
    const gate = deferred<Response>();
    const harness = createHarness({
      coverLetter: () => gate.promise,
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);

    expect(screen.queryByText(/cota|análises usadas|limite de uso/i)).not.toBeInTheDocument();
    await user.type(companyField(), '  Acme  ');
    await user.click(screen.getByTestId('cover-letter-generate'));

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-loading')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cover-letter-generate')).toBeDisabled();
    expect(harness.coverCalls).toHaveLength(1);

    gate.resolve(
      jsonResponse({
        texto_resposta: letterText,
        pdf_url: '/users/me/files/carta-acme.pdf',
        user_id: 'user-1',
        ...secretFields,
      }),
    );

    const text = await screen.findByTestId('cover-letter-text');
    expect(text.textContent).toBe(letterText);
    expect(text.className).toContain('whitespace-pre-wrap');
    expect(screen.getByTestId('cover-letter-result')).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('cover-letter-result'));
    });
    expect(screen.getByRole('button', { name: 'Baixar PDF' })).toBeEnabled();
    expect(screen.queryByTestId('cover-letter-quota')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cargo/i)).not.toBeInTheDocument();
    expectNoSecrets(document.body.textContent ?? '');

    const createObjectURL = vi.fn(() => 'blob:carta-acme');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    expect(harness.coverCalls).toHaveLength(1);
    const call = harness.coverCalls[0];
    expect(call.url).toContain('/users/me/cover-letter');
    expect(call.url).not.toContain('jwt-login');
    expect(new Headers(call.init?.headers).get('Authorization')).toBe('Bearer jwt-login');
    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ empresa: 'Acme' });
    expect(Object.keys(body)).toEqual(['empresa']);
    expect(
      harness.fetchImpl.mock.calls.some(([input]) => String(input).includes('/processar')),
    ).toBe(false);

    await user.click(screen.getByTestId('cover-letter-download'));
    expect(await screen.findByTestId('cover-letter-download-success')).toHaveTextContent(
      'PDF da carta baixado.',
    );
    expect(harness.fileCalls).toHaveLength(1);
    expect(harness.fileCalls[0].url).toContain('/users/me/files/carta-acme.pdf');
    expect(harness.fileCalls[0].url).not.toContain('jwt-login');
    expect(harness.fileCalls[0].url).not.toContain('token=');
    expect(new Headers(harness.fileCalls[0].init?.headers).get('Authorization')).toBe(
      'Bearer jwt-login',
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:carta-acme');
  });

  it('400 de currículo mostra a mesma orientação, sem texto técnico', async () => {
    const harness = createHarness({
      coverLetter: () =>
        jsonResponse(
          {
            detail:
              'Curriculo nao esta pronto para analise. Embeddings do usuario nao encontrados. POST /users/me/rebuild-embeddings chroma_dir object_key cv_file original_file vector_store extracted_text_object_key',
          },
          400,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);
    await user.type(companyField(), 'Acme');
    await user.click(screen.getByTestId('cover-letter-generate'));

    const gate = await screen.findByTestId('cover-letter-cv-gate');
    expect(gate).toHaveTextContent(COVER_LETTER_CV_GUIDANCE);
    expect(screen.queryByTestId('cover-letter-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cover-letter-text')).not.toBeInTheDocument();
    const visible = document.body.textContent ?? '';
    expect(visible).not.toMatch(/embedding|rebuild|\/users\/me|chroma_dir|object_key|cv_file|original_file|vector_store|extracted_text/i);
    expect(companyField()).toHaveValue('Acme');
    expect(screen.getByTestId('cover-letter-generate')).toBeDisabled();
    expect(harness.coverCalls).toHaveLength(1);
  });

  it('500 preserva o que foi digitado', async () => {
    const harness = createHarness({
      coverLetter: () =>
        jsonResponse(
          { detail: 'Erro interno ao gerar carta de apresentacao. File "/app/main.py"' },
          500,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);
    await user.type(companyField(), 'Empresa Alfa');
    await user.click(screen.getByTestId('cover-letter-generate'));

    const error = await screen.findByTestId('cover-letter-error');
    expect(error).toHaveTextContent(COVER_LETTER_FAILED);
    expect(error).toHaveAttribute('aria-live', 'polite');
    expect(error.textContent).not.toMatch(/main\.py|\/users\/me|apresentacao/i);
    expect(companyField()).toHaveValue('Empresa Alfa');
    await waitFor(() => {
      expect(document.activeElement).toBe(error);
    });
  });

  it('falha de rede preserva o que foi digitado', async () => {
    const harness = createHarness({
      coverLetter: () => {
        throw new TypeError('Failed to fetch https://api.example.test/users/me/cover-letter');
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);
    await user.type(companyField(), 'Empresa Alfa');
    await user.click(screen.getByTestId('cover-letter-generate'));

    const error = await screen.findByTestId('cover-letter-error');
    expect(error).toHaveTextContent(COVER_LETTER_FAILED);
    expect(error.textContent).not.toMatch(/https:|cover-letter|example\.test/i);
    expect(companyField()).toHaveValue('Empresa Alfa');
  });

  it('429 avisa muitas tentativas e preserva o que foi digitado', async () => {
    const harness = createHarness({
      coverLetter: () =>
        jsonResponse(
          { detail: 'Assine em https://billing.example/checkout' },
          429,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);
    await user.type(companyField(), 'Empresa Alfa');
    await user.click(screen.getByTestId('cover-letter-generate'));

    const error = await screen.findByTestId('cover-letter-error');
    expect(error).toHaveTextContent(COVER_LETTER_RATE_LIMIT);
    expect(error.textContent?.toLowerCase()).not.toMatch(/assin|checkout|cota|limite de uso/);
    expect(screen.queryByTestId('cover-letter-quota')).not.toBeInTheDocument();
    expect(companyField()).toHaveValue('Empresa Alfa');
  });

  it('403 de termos abre o ConsentGate e mantém a empresa', async () => {
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
    await openCarta(user);
    await user.type(companyField(), 'Empresa Alfa');
    await user.click(screen.getByTestId('cover-letter-generate'));

    expect(await screen.findByTestId('consent-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('cover-letter-error')).not.toBeInTheDocument();
    expect(companyField()).toHaveValue('Empresa Alfa');
  });

  it('não grava formulário, carta nem arquivo interno', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const harness = createHarness();
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);
    await user.type(companyField(), 'Acme Sigilosa');
    await user.click(screen.getByTestId('cover-letter-generate'));
    expect((await screen.findByTestId('cover-letter-text')).textContent).toBe(letterText);

    const dump = storedDump();
    expect(dump).not.toContain('Acme Sigilosa');
    expect(dump).not.toContain('Tenho interesse');
    expectNoSecrets(dump);
    expect(window.sessionStorage.length).toBe(0);
    for (const call of setItem.mock.calls) {
      expect(call[0] === 'mae.sessionLease' || call[0] === 'mae.loggedOut').toBe(true);
      expect(String(call[1])).not.toMatch(/Acme Sigilosa|Tenho interesse|jwt-login|cv_file|object_key/i);
    }
  });

  it('sem sessão /app/carta volta ao login e não chama a carta', async () => {
    const harness = createHarness();
    renderApp(harness.fetchImpl, '/app/carta');
    expect(await screen.findByTestId('auth-tab-login')).toBeInTheDocument();
    expect(harness.coverCalls).toHaveLength(0);

    const user = userEvent.setup();
    await login(user);
    expect(await screen.findByTestId('carta-page')).toBeInTheDocument();
    expect(harness.coverCalls).toHaveLength(0);
  });

  it('falha ao ler o status não gera a carta', async () => {
    const harness = createHarness({
      status: () => jsonResponse({ detail: 'GET /users/me/status indisponivel' }, 500),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openCarta(user);

    const error = await screen.findByTestId('carta-status-error');
    expect(error).toHaveTextContent(COVER_LETTER_STATUS_CHECK_FAILED);
    expect(error.textContent).not.toMatch(/\/users\/me|status/i);
    await user.type(companyField(), 'Acme');
    expect(screen.getByTestId('cover-letter-generate')).toBeDisabled();
    fireEvent.click(screen.getByTestId('cover-letter-generate'));
    expect(harness.coverCalls).toHaveLength(0);
  });
});
