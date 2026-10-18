import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import {
  CV_INVALID,
  CV_NOT_READY,
  CV_OFFLINE,
  CV_REBUILD_BAD_REQUEST,
  CV_TOO_LARGE,
  CV_UNAVAILABLE,
  CV_UPLOAD_BAD_REQUEST,
  MAX_CV_UPLOAD_BYTES,
} from '../api/cv';
import { AuthProvider } from '../auth/AuthContext';

const LEAK =
  'Nao foi possivel Internal Server Error main.py POST json Request Entity Too Large';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

const FORBIDDEN = [
  'Nao foi possivel',
  'Internal Server Error',
  'main.py',
  'POST',
  'json',
  'Request Entity',
] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createHarness(options: {
  upload?: () => Response | Promise<Response>;
  rebuild?: () => Response | Promise<Response>;
}) {
  let rebuildCalls = 0;
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
      return jsonResponse(userBody);
    }
    if (url.includes('/users/me/status')) {
      return jsonResponse({
        has_cv: false,
        has_embeddings: false,
        has_profile: false,
        generated_files: 0,
      });
    }
    if (url.includes('/billing/me')) {
      return jsonResponse({
        plan: 'free',
        used: 1,
        limit: 5,
        remaining: 4,
        period_end: '2026-11-01T00:00:00Z',
      });
    }
    if (url.includes('/users/me/upload-cv')) {
      expect(init?.body).toBeInstanceOf(FormData);
      return (await options.upload?.()) ?? jsonResponse({ filename: 'cv.pdf' });
    }
    if (url.includes('/users/me/rebuild-embeddings')) {
      rebuildCalls += 1;
      expect(init?.body).toBeUndefined();
      return (await options.rebuild?.()) ?? jsonResponse({ chunks: 1 });
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'ausente' }, 404);
  });

  return {
    fetchImpl,
    get rebuildCalls() {
      return rebuildCalls;
    },
  };
}

function renderApp(fetchImpl: ReturnType<typeof vi.fn>) {
  return render(
    <MemoryRouter initialEntries={['/entrar']}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function openUpload(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await waitFor(() => {
    expect(screen.getByTestId('home-shell')).toBeInTheDocument();
  });
  await user.click(screen.getByTestId('nav-curriculo'));
  await waitFor(() => {
    expect(screen.getByTestId('cv-panel')).toBeInTheDocument();
  });
}

function choosePdf() {
  fireEvent.change(screen.getByTestId('cv-file'), {
    target: {
      files: [new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' })],
    },
  });
}

function uploadHits(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.filter(([input]) =>
    String(input).includes('/users/me/upload-cv'),
  ).length;
}

function expectFixed(expected: string) {
  const error = screen.getByTestId('cv-error');
  expect(error).toHaveTextContent(expected);
  const shown = error.textContent ?? '';
  for (const leak of FORBIDDEN) {
    expect(shown).not.toContain(leak);
  }
}

describe('erros fixos de upload e rebuild', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('200 sem embeddings mostra o texto fixo e o retry de rebuild', async () => {
    const harness = createHarness({
      upload: () =>
        jsonResponse({
          filename: 'cv.pdf',
          updated_at: '2026-10-18T18:40:56Z',
          has_cv: true,
          has_embeddings: false,
          ready_for_analysis: true,
          reason: LEAK,
        }),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expectFixed(CV_NOT_READY);
    });
    expect(screen.getByTestId('cv-retry')).toBeInTheDocument();
    expect(harness.rebuildCalls).toBe(0);

    await user.click(screen.getByTestId('cv-retry'));
    await waitFor(() => {
      expect(harness.rebuildCalls).toBe(1);
    });
  });

  it('400 no upload mostra o texto fixo', async () => {
    const harness = createHarness({
      upload: () => jsonResponse({ detail: LEAK }, 400),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_UPLOAD_BAD_REQUEST);
    });
    expect(harness.rebuildCalls).toBe(0);
  });

  it('400 no rebuild mostra o texto fixo', async () => {
    const harness = createHarness({
      upload: () =>
        jsonResponse({
          filename: 'cv.pdf',
          has_embeddings: false,
          ready_for_analysis: false,
          reason: LEAK,
        }),
      rebuild: () => jsonResponse({ detail: LEAK }, 400),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('cv-retry')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('cv-retry'));
    await waitFor(() => {
      expectFixed(CV_REBUILD_BAD_REQUEST);
    });
    expect(harness.rebuildCalls).toBe(1);
  });

  it('arquivo maior que 10 MB não chama o fetch', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    fireEvent.change(screen.getByTestId('cv-file'), {
      target: {
        files: [
          new File([new Uint8Array(MAX_CV_UPLOAD_BYTES + 1)], 'grande.pdf', {
            type: 'application/pdf',
          }),
        ],
      },
    });
    expect(uploadHits(harness.fetchImpl)).toBe(0);
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_TOO_LARGE);
    });
    expect(uploadHits(harness.fetchImpl)).toBe(0);
    expect(screen.getByTestId('cv-error').textContent).not.toMatch(/\b413\b/);
  });

  it('413 mostra o texto fixo', async () => {
    const harness = createHarness({
      upload: () => jsonResponse({ detail: `413 ${LEAK}` }, 413),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_TOO_LARGE);
    });
  });

  it('500 text/plain com traceback mostra o texto fixo', async () => {
    const harness = createHarness({
      upload: () =>
        new Response(
          `Traceback (most recent call last):\n  File "main.py", line 12, in upload_cv\n${LEAK}`,
          { status: 500, headers: { 'Content-Type': 'text/plain' } },
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_UNAVAILABLE);
    });
  });

  it('502 mostra o texto fixo', async () => {
    const harness = createHarness({
      upload: () => jsonResponse({ detail: `502 ${LEAK}` }, 502),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_UNAVAILABLE);
    });
  });

  it('503 mostra o texto fixo sem o código', async () => {
    const harness = createHarness({
      upload: () => jsonResponse({ detail: `503 Servico indisponivel ${LEAK}` }, 503),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_UNAVAILABLE);
    });
    expect(screen.getByTestId('cv-error').textContent).not.toMatch(/\b503\b/);
  });

  it('400 de limite usa o texto de tamanho e esconde o detail', async () => {
    const harness = createHarness({
      upload: () =>
        jsonResponse(
          { detail: `o arquivo excede o teto-interno ${LEAK}` },
          400,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_TOO_LARGE);
    });
    expect(screen.getByTestId('cv-error').textContent).not.toContain('teto-interno');
    expect(screen.getByTestId('cv-error').textContent).not.toContain('excede');
  });

  it('422 mostra o texto de dado inválido', async () => {
    const harness = createHarness({
      upload: () => jsonResponse({ detail: `422 ${LEAK}` }, 422),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_INVALID);
    });
    expect(screen.getByTestId('cv-error')).not.toHaveTextContent(CV_UNAVAILABLE);
  });

  it('erro de rede mostra falta de conexão', async () => {
    const harness = createHarness({
      upload: () => {
        throw new TypeError(`Failed to fetch ${LEAK}`);
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_OFFLINE);
    });
    expect(screen.getByTestId('cv-error')).not.toHaveTextContent(CV_UNAVAILABLE);
  });

  it('401 não mostra retry e volta ao login', async () => {
    const harness = createHarness({
      upload: () => jsonResponse({ detail: `token expirado ${LEAK}` }, 401),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('login-email')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('cv-retry')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
    const shown = document.body.textContent ?? '';
    for (const leak of FORBIDDEN) {
      expect(shown).not.toContain(leak);
    }
  });

  it("detail com POST ou json não aparece na tela", async () => {
    const harness = createHarness({
      upload: () =>
        jsonResponse(
          { detail: 'falha no POST ao ler json do Request Entity main.py' },
          400,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openUpload(user);
    choosePdf();
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expectFixed(CV_UPLOAD_BAD_REQUEST);
    });
  });
});
