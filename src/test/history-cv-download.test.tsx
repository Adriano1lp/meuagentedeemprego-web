import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import {
  HISTORY_CV_DOWNLOAD_FAILED,
  HISTORY_DOWNLOAD_INVALID,
  HISTORY_PDF_DOWNLOAD_FAILED,
  historyDownloadErrorLeaksInternals,
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
  cv_file_name: 'cv-acme.pdf',
  pdf_url: '/users/me/files/vaga-acme.pdf',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pdfBytes(text = '%PDF-1.4\ncv'): Response {
  return new Response(new TextEncoder().encode(text), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });
}

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  fileCalls: Array<{ url: string; init?: RequestInit }>;
  coverCalls: Array<{ url: string; init?: RequestInit }>;
};

function createHarness(options: {
  history?: unknown | (() => Response);
  me?: () => Response;
  file?: () => Response | Promise<Response>;
  coverLetter?: () => Response | Promise<Response>;
}): Harness {
  const fileCalls: Harness['fileCalls'] = [];
  const coverCalls: Harness['coverCalls'] = [];

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
      return (
        options.coverLetter?.() ??
        jsonResponse({
          texto_resposta: 'Ola, Acme.',
          pdf_url: '/users/me/files/carta-acme.pdf',
          user_id: 'user-1',
        })
      );
    }
    if (url.includes('/users/me/files/')) {
      fileCalls.push({ url, init });
      return options.file?.() ?? pdfBytes();
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });

  return { fetchImpl, fileCalls, coverCalls };
}

function authHeader(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('Authorization');
}

function hasUserIdHeader(init?: RequestInit): boolean {
  const headers = new Headers(init?.headers);
  return headers.get('X-User-Id') != null || headers.get('x-user-id') != null;
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

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
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

function leakedDetail(path: string): string {
  return `File "/app/main.py" GET ${path} Bearer jwt-login https://meu-agente-de-emprego.onrender.com X-User-Id`;
}

describe('Feature: Download do CV no historico', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mostra Baixar CV e o PDF da vaga quando os arquivos existem', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);

    const card = screen.getByTestId('history-item');
    expect(within(card).getByTestId('history-cv-download')).toHaveTextContent(
      'Baixar CV',
    );
    expect(within(card).getByTestId('history-cv-download')).toHaveAttribute(
      'aria-label',
      'Baixar CV da analise Desenvolvedor Flutter',
    );
    expect(within(card).getByTestId('history-pdf-download')).toHaveTextContent(
      'Baixar PDF da vaga',
    );
    expect(within(card).getByTestId('cover-letter-generate')).toBeEnabled();
    expect(card.querySelector('a')).toBeNull();
    expect(harness.fileCalls).toHaveLength(0);
  });

  it('sem cv_file_name nao mostra CTA de CV e nao chama /files', async () => {
    const harness = createHarness({
      history: {
        items: [
          { ...historyItem, id: '1', cv_file_name: null, pdf_url: null },
          { ...historyItem, id: '2', cv_file_name: '', pdf_url: '   ' },
          { ...historyItem, id: '3', cv_file_name: '   ', pdf_url: null },
          {
            ...historyItem,
            id: '4',
            job_title: 'Sem campo',
            cv_file_name: undefined,
            pdf_url: undefined,
          },
          {
            ...historyItem,
            id: '5',
            job_title: 'So PDF',
            cv_file_name: null,
            pdf_url: '/users/me/files/vaga-acme.pdf',
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
    expect(cards).toHaveLength(5);
    for (const card of cards.slice(0, 4)) {
      expect(within(card).queryByTestId('history-cv-download')).toBeNull();
    }
    expect(within(cards[4]).queryByTestId('history-cv-download')).toBeNull();
    expect(within(cards[4]).getByTestId('history-pdf-download')).toBeEnabled();
    expect(within(cards[0]).getByTestId('cover-letter-generate')).toBeEnabled();
    expect(harness.fileCalls).toHaveLength(0);
  });

  it('baixa o CV com Bearer, blob e object URL revogada, sem X-User-Id', async () => {
    const downloaded: { blob: Blob | null } = { blob: null };
    const createObjectURL = vi.fn((blob: Blob) => {
      downloaded.blob = blob;
      return 'blob:cv-acme';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const anchors: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push({
        href: this.getAttribute('href') ?? '',
        download: this.download,
      });
    });

    const gate = deferred<Response>();
    const harness = createHarness({
      file: () => gate.promise,
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);

    const button = screen.getByTestId('history-cv-download');
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Baixando CV...');
    expect(screen.getByTestId('cover-letter-generate')).toBeEnabled();
    expect(screen.getByTestId('history-pdf-download')).toBeEnabled();
    expect(harness.fileCalls).toHaveLength(1);

    const fileCall = harness.fileCalls[0];
    expect(fileCall.url).toContain('/users/me/files/cv-acme.pdf');
    expect(fileCall.url).not.toContain('token=');
    expect(fileCall.url).not.toContain('jwt-login');
    expect(fileCall.url).not.toContain('cdn.evil');
    expect(authHeader(fileCall.init)).toBe('Bearer jwt-login');
    expect(hasUserIdHeader(fileCall.init)).toBe(false);
    expect(fileCall.init?.method).toBe('GET');

    gate.resolve(pdfBytes());

    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-success')).toHaveTextContent(
        'CV baixado.',
      );
    });
    expect(screen.getByTestId('history-cv-download')).toBeEnabled();
    expect(screen.getByTestId('history-cv-download')).toHaveTextContent('Baixar CV');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloaded.blob?.type).toBe('application/pdf');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cv-acme');
    expect(anchors).toEqual([
      { href: 'blob:cv-acme', download: 'cv-acme.pdf' },
    ]);
    expect(anchors.some((anchor) => anchor.href.includes('/users/me/'))).toBe(
      false,
    );
    expect(screen.getByTestId('history-item').querySelector('a')).toBeNull();
    expect(screen.getByTestId('history-list')).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('PDF da vaga usa o nome do arquivo, nao a URL absoluta com token', async () => {
    const createObjectURL = vi.fn(() => 'blob:vaga');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const harness = createHarness({
      history: {
        items: [
          {
            ...historyItem,
            cv_file_name: null,
            pdf_url:
              'https://cdn.evil.test/users/me/files/vaga-acme.pdf?token=jwt-login',
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

    expect(screen.queryByTestId('history-cv-download')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('history-pdf-download'));

    await waitFor(() => {
      expect(screen.getByTestId('history-pdf-download-success')).toHaveTextContent(
        'PDF da vaga baixado.',
      );
    });
    expect(harness.fileCalls).toHaveLength(1);
    const fileCall = harness.fileCalls[0];
    expect(fileCall.url).toContain('/users/me/files/vaga-acme.pdf');
    expect(fileCall.url).not.toContain('cdn.evil.test');
    expect(fileCall.url).not.toContain('token=');
    expect(fileCall.url).not.toContain('jwt-login');
    expect(authHeader(fileCall.init)).toBe('Bearer jwt-login');
    expect(hasUserIdHeader(fileCall.init)).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:vaga');
  });

  it('CV que nao e PDF baixa o arquivo sem exigir magic %PDF', async () => {
    const downloaded: { blob: Blob | null } = { blob: null };
    const createObjectURL = vi.fn((blob: Blob) => {
      downloaded.blob = blob;
      return 'blob:cv-txt';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    const harness = createHarness({
      history: {
        items: [
          {
            ...historyItem,
            cv_file_name: 'cv-acme.txt',
            pdf_url: null,
          },
        ],
        limit: 20,
        offset: 0,
      },
      file: () =>
        new Response(new TextEncoder().encode('Curriculo em texto'), {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    expect(screen.queryByTestId('history-pdf-download')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('history-cv-download'));

    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-success')).toHaveTextContent(
        'CV baixado.',
      );
    });
    expect(harness.fileCalls[0].url).toContain('/users/me/files/cv-acme.txt');
    expect(authHeader(harness.fileCalls[0].init)).toBe('Bearer jwt-login');
    expect(hasUserIdHeader(harness.fileCalls[0].init)).toBe(false);
    expect(downloaded.blob?.type).toBe('application/octet-stream');
    expect(downloads).toEqual(['cv-acme.txt']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cv-txt');
  });

  it('404 e 500 mostram mensagem generica e o botao volta a aceitar clique', async () => {
    let attempts = 0;
    const harness = createHarness({
      file: () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({ detail: leakedDetail('/users/me/files/cv-acme.pdf') }, 404);
        }
        if (attempts === 2) {
          return jsonResponse({ detail: leakedDetail('/users/me/files/cv-acme.pdf') }, 500);
        }
        return pdfBytes();
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);

    await user.click(screen.getByTestId('history-cv-download'));
    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-error')).toHaveTextContent(
        HISTORY_CV_DOWNLOAD_FAILED,
      );
    });
    const firstError = screen.getByTestId('history-cv-download-error').textContent ?? '';
    expect(historyDownloadErrorLeaksInternals(firstError)).toBe(false);
    expect(firstError).not.toContain('/users/me');
    expect(firstError).not.toContain('cv-acme.pdf');
    expect(firstError).not.toContain('jwt-login');
    expect(firstError).not.toContain('onrender.com');
    expect(firstError).not.toContain('X-User-Id');
    expect(screen.getByTestId('history-list')).toBeInTheDocument();
    expect(screen.getByTestId('cover-letter-generate')).toBeEnabled();
    expect(screen.getByTestId('history-cv-download')).toBeEnabled();
    expect(document.activeElement).toBe(screen.getByTestId('history-cv-download-error'));

    await user.click(screen.getByTestId('history-cv-download'));
    await waitFor(() => {
      expect(harness.fileCalls).toHaveLength(2);
      expect(screen.getByTestId('history-cv-download')).toBeEnabled();
    });
    expect(screen.getByTestId('history-cv-download-error')).toHaveTextContent(
      HISTORY_CV_DOWNLOAD_FAILED,
    );

    const createObjectURL = vi.fn(() => 'blob:retry');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(screen.getByTestId('history-cv-download'));
    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-success')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('history-cv-download-error')).not.toBeInTheDocument();
    expect(harness.fileCalls).toHaveLength(3);
    expect(attempts).toBe(3);
  });

  it('falha de rede nao vaza a URL e mantem Gerar carta', async () => {
    const harness = createHarness({
      file: () => {
        throw new TypeError(
          'Failed to fetch https://meu-agente-de-emprego.onrender.com/users/me/files/cv-acme.pdf',
        );
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('history-cv-download'));

    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-error')).toHaveTextContent(
        HISTORY_CV_DOWNLOAD_FAILED,
      );
    });
    const text = screen.getByTestId('history-cv-download-error').textContent ?? '';
    expect(historyDownloadErrorLeaksInternals(text)).toBe(false);
    expect(text).not.toContain('onrender.com');
    expect(text).not.toContain('/files/');
    expect(screen.getByTestId('history-list')).toBeInTheDocument();
    expect(screen.getByTestId('cover-letter-generate')).toBeEnabled();
  });

  it('bytes que nao sao PDF nao contam como download do CV', async () => {
    const createObjectURL = vi.fn(() => 'blob:html');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const harness = createHarness({
      file: () =>
        new Response(new TextEncoder().encode('<html>erro</html>'), {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('history-cv-download'));

    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-error')).toHaveTextContent(
        HISTORY_DOWNLOAD_INVALID,
      );
    });
    expect(historyDownloadErrorLeaksInternals(
      screen.getByTestId('history-cv-download-error').textContent ?? '',
    )).toBe(false);
    expect(screen.queryByTestId('history-cv-download-success')).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByTestId('history-cv-download')).toBeEnabled();
  });

  it('erro do PDF da vaga fica generico e nao some com o CV', async () => {
    const harness = createHarness({
      file: () =>
        jsonResponse({ detail: leakedDetail('/users/me/files/vaga-acme.pdf') }, 502),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('history-pdf-download'));

    await waitFor(() => {
      expect(screen.getByTestId('history-pdf-download-error')).toHaveTextContent(
        HISTORY_PDF_DOWNLOAD_FAILED,
      );
    });
    const text = screen.getByTestId('history-pdf-download-error').textContent ?? '';
    expect(historyDownloadErrorLeaksInternals(text)).toBe(false);
    expect(screen.getByTestId('history-cv-download')).toBeEnabled();
    expect(screen.queryByTestId('history-cv-download-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('cover-letter-generate')).toBeEnabled();
  });

  it('401 no download volta ao login sem mostrar token', async () => {
    const harness = createHarness({
      file: () =>
        jsonResponse(
          { detail: 'Bearer jwt-login expirado em /users/me/files/cv-acme.pdf' },
          401,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('history-cv-download'));

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/');
    });
    expect(screen.getByTestId('auth-tab-login')).toBeInTheDocument();
    expect(screen.queryByTestId('history-cv-download-error')).not.toBeInTheDocument();
    expect(screen.queryByText(/jwt-login/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/users\/me/)).not.toBeInTheDocument();
  });

  it('403 TERMS_OUTDATED e PRIVACY_OUTDATED abrem o ConsentGate', async () => {
    for (const code of ['TERMS_OUTDATED', 'PRIVACY_OUTDATED'] as const) {
      cleanup();
      const harness = createHarness({
        file: () =>
          jsonResponse(
            {
              detail: {
                code,
                message: `Reaceite em https://evil.test/users/me/files/cv-acme.pdf Bearer jwt-login`,
              },
            },
            403,
          ),
      });
      const user = userEvent.setup();
      renderApp(harness.fetchImpl);
      await login(user);
      await openHistory(user);
      await user.click(screen.getByTestId('history-cv-download'));

      await waitFor(() => {
        expect(screen.getByTestId('consent-gate')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('history-cv-download-error')).not.toBeInTheDocument();
      expect(screen.queryByText(/jwt-login/)).not.toBeInTheDocument();
      expect(screen.queryByText(/evil\.test/)).not.toBeInTheDocument();
      expect(screen.getByTestId('history-list')).toBeInTheDocument();
      cleanup();
    }
  });

  it('Gerar carta continua funcionando no item com CV', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('cover-letter-generate'));

    await waitFor(() => {
      expect(screen.getByTestId('cover-letter-text')).toHaveTextContent('Ola, Acme.');
    });
    expect(harness.coverCalls).toHaveLength(1);
    expect(authHeader(harness.coverCalls[0].init)).toBe('Bearer jwt-login');
    expect(hasUserIdHeader(harness.coverCalls[0].init)).toBe(false);
    expect(JSON.parse(String(harness.coverCalls[0].init?.body))).toEqual({
      empresa: 'Acme',
    });
    expect(screen.getByTestId('history-cv-download')).toBeEnabled();
    expect(harness.fileCalls).toHaveLength(0);
  });

  it('PDF bloqueado nao mostra CTA mesmo com pdf_url', async () => {
    const harness = createHarness({
      history: {
        items: [
          {
            ...historyItem,
            cv_file_name: null,
            generation_blocked: true,
            blocked_reason: 'aderencia baixa',
            pdf_url: '/users/me/files/vaga-acme.pdf',
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

    expect(screen.queryByTestId('history-cv-download')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-pdf-download')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-item-blocked')).toHaveTextContent(
      'PDF nao gerado: aderencia baixa',
    );
    expect(harness.fileCalls).toHaveLength(0);
  });

  it('aceite seg: Bearer e Blob, sem link publico, storage, log, HTML ou Stripe', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const idbOpens: string[] = [];
    vi.stubGlobal('indexedDB', {
      open(name: string) {
        idbOpens.push(name);
        throw new Error('indexedDB nao deve ser usado');
      },
    });
    const consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const downloaded: { blob: Blob | null } = { blob: null };
    const createObjectURL = vi.fn((blob: Blob) => {
      downloaded.blob = blob;
      return 'blob:cv-seguro';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const anchors: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push({
        href: this.getAttribute('href') ?? '',
        download: this.download,
      });
    });
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null);

    const publicCv =
      'https://cdn.public.test/cv-publico.pdf?token=jwt-login&access_token=jwt-login';
    const harness = createHarness({
      history: {
        items: [
          {
            ...historyItem,
            cv_file_name: publicCv,
            pdf_url: 'https://cdn.public.test/arquivo-publico.pdf',
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

    const panel = screen.getByTestId('history-panel');
    expect(panel.querySelector('a')).toBeNull();
    expect(panel.textContent).not.toContain('cdn.public.test');
    expect(panel.textContent).not.toContain('token=');
    expect(panel.textContent).not.toContain('jwt-login');
    expect(screen.queryByTestId('history-pdf-download')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-cv-download')).toBeEnabled();
    expect(panel.textContent?.toLowerCase()).not.toMatch(
      /stripe|checkout|pagamento|upgrade/,
    );

    await user.click(screen.getByTestId('history-cv-download'));
    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-success')).toHaveTextContent(
        'CV baixado.',
      );
    });

    expect(harness.fileCalls).toHaveLength(1);
    const fileCall = harness.fileCalls[0];
    expect(fileCall.url).toContain('/users/me/files/cv-publico.pdf');
    expect(fileCall.url).not.toContain('cdn.public.test');
    expect(fileCall.url).not.toContain('token=');
    expect(fileCall.url).not.toContain('jwt-login');
    expect(fileCall.url).not.toContain('access_token');
    expect(authHeader(fileCall.init)).toBe('Bearer jwt-login');
    expect(hasUserIdHeader(fileCall.init)).toBe(false);
    expect(anchors).toEqual([
      { href: 'blob:cv-seguro', download: 'cv-publico.pdf' },
    ]);
    expect(anchors[0].href.startsWith('blob:')).toBe(true);
    expect(downloaded.blob).toBeInstanceOf(Blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cv-seguro');
    expect(openWindow).not.toHaveBeenCalled();
    expect(panel.querySelector('a')).toBeNull();

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(idbOpens).toEqual([]);
    const stored = `${window.localStorage} ${window.sessionStorage}`;
    expect(stored).not.toContain('%PDF');
    expect(stored).not.toContain('jwt-login');

    const logs = consoleSpies.flatMap((spy) => spy.mock.calls).map((args) =>
      args.map((arg) => String(arg)).join(' '),
    ).join('\n');
    expect(logs.toLowerCase()).not.toContain('jwt-login');
    expect(logs.toLowerCase()).not.toContain('authorization');
    expect(logs.toLowerCase()).not.toContain('bearer');
    expect(logs).not.toContain('%PDF');
  });

  it('aceite seg: erro HTML ou stack vira so a mensagem fixa', async () => {
    const harness = createHarness({
      file: () =>
        new Response(
          '<html><script>Bearer jwt-login</script> GET /users/me/files/cv-acme.pdf https://meu-agente-de-emprego.onrender.com\n    at read_file (/app/main.py:12)',
          { status: 500, headers: { 'Content-Type': 'text/html' } },
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await openHistory(user);
    await user.click(screen.getByTestId('history-cv-download'));

    await waitFor(() => {
      expect(screen.getByTestId('history-cv-download-error')).toHaveTextContent(
        HISTORY_CV_DOWNLOAD_FAILED,
      );
    });
    const text = screen.getByTestId('history-cv-download-error').textContent ?? '';
    expect(text).toBe(HISTORY_CV_DOWNLOAD_FAILED);
    expect(historyDownloadErrorLeaksInternals(text)).toBe(false);
    expect(text).not.toContain('<');
    expect(text).not.toContain('script');
    expect(text).not.toContain('jwt-login');
    expect(text).not.toContain('/users/me');
    expect(text).not.toContain('onrender.com');
    expect(text).not.toMatch(/at read_file/);
    expect(screen.getByTestId('history-panel').textContent?.toLowerCase()).not.toMatch(
      /stripe|checkout|pagamento/,
    );
  });
});
