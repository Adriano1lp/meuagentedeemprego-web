import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

const baseStatus = {
  user_id: 'user-1',
  has_cv: false,
  has_profile: false,
  has_embeddings: false,
  generated_files: 0,
  plan: 'free',
  used: 0,
  limit: 5,
  remaining: 5,
  period: '2026-09',
  subscription_status: 'none',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  uploadCalls: number;
  rebuildCalls: number;
  pathCalls: string[];
};

function createHarness(options: {
  status?: unknown | (() => unknown);
  upload?: () => Response;
  rebuild?: () => Promise<Response> | Response;
}): Harness {
  let uploadCalls = 0;
  let rebuildCalls = 0;
  const pathCalls: string[] = [];

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
      pathCalls.push('status');
      const payload =
        typeof options.status === 'function' ? options.status() : options.status;
      return jsonResponse(payload ?? baseStatus);
    }
    if (url.includes('/users/me/upload-cv')) {
      pathCalls.push('upload-cv');
      uploadCalls += 1;
      expect(init?.body).toBeInstanceOf(FormData);
      return options.upload?.() ?? jsonResponse({ filename: 'cv.pdf' });
    }
    if (url.includes('/users/me/rebuild-embeddings')) {
      pathCalls.push('rebuild-embeddings');
      rebuildCalls += 1;
      expect(init?.method).toBe('POST');
      return options.rebuild?.() ?? jsonResponse({ chunks: 3 });
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });

  return {
    fetchImpl,
    pathCalls,
    get uploadCalls() {
      return uploadCalls;
    },
    get rebuildCalls() {
      return rebuildCalls;
    },
  };
}

async function loginWithoutReady(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await waitFor(() => {
    expect(screen.getByTestId('home-shell')).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(screen.getByTestId('cv-panel')).toBeInTheDocument();
  });
}

function renderApp(fetchImpl: Harness['fetchImpl']) {
  return render(
    <MemoryRouter>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function pdfFile(name = 'cv.pdf'): File {
  return new File(['%PDF-1.4 mae'], name, { type: 'application/pdf' });
}

describe('HomePage CV upload + embeddings gate', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. sem CV valido bloqueia Analisar vaga com mensagem clara', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginWithoutReady(user);

    await waitFor(() => {
      expect(screen.getByTestId('cv-missing')).toHaveTextContent(
        'Sem curriculo valido',
      );
    });
    expect(screen.getByTestId('processar-gate')).toHaveTextContent(
      'Sem curriculo valido',
    );
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(screen.queryByTestId('cv-ready')).not.toBeInTheDocument();
  });

  it('2. upload ok mostra processando embeddings e depois pronto', async () => {
    let uploaded = false;
    let rebuilt = false;
    let releaseRebuild: (() => void) | undefined;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });

    const harness = createHarness({
      status: () => ({
        ...baseStatus,
        has_cv: uploaded,
        has_embeddings: rebuilt,
      }),
      upload: () => {
        uploaded = true;
        return jsonResponse({ filename: 'cv.pdf', bytes_received: 12 });
      },
      rebuild: async () => {
        await rebuildGate;
        rebuilt = true;
        return jsonResponse({ chunks: 4, vector_store: 'mongodb' });
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginWithoutReady(user);

    await user.upload(screen.getByTestId('cv-file'), pdfFile());
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-processing')).toHaveTextContent(
        'Processando embeddings',
      );
    });
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(screen.getByTestId('processar-gate')).toHaveTextContent(
      'Processando embeddings',
    );

    releaseRebuild?.();

    await waitFor(() => {
      expect(screen.getByTestId('cv-ready')).toHaveTextContent('Pronto');
    });
    expect(screen.queryByTestId('cv-processing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('processar-gate')).not.toBeInTheDocument();

    await user.type(
      screen.getByTestId('processar-texto'),
      'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
    );
    expect(screen.getByTestId('processar-submit')).toBeEnabled();
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(1);
    const uploadAt = harness.pathCalls.indexOf('upload-cv');
    const rebuildAt = harness.pathCalls.indexOf('rebuild-embeddings');
    expect(uploadAt).toBeGreaterThanOrEqual(0);
    expect(rebuildAt).toBeGreaterThan(uploadAt);
    expect(harness.pathCalls.slice(rebuildAt + 1)).toContain('status');
  });

  it('3. erro de upload mostra estado de erro e retry reenvia', async () => {
    let failUpload = true;
    let uploaded = false;
    let rebuilt = false;
    const harness = createHarness({
      status: () => ({
        ...baseStatus,
        has_cv: uploaded,
        has_embeddings: rebuilt,
      }),
      upload: () => {
        if (failUpload) {
          return jsonResponse(
            { detail: 'Nao foi possivel extrair texto do arquivo enviado' },
            400,
          );
        }
        uploaded = true;
        return jsonResponse({ filename: 'cv.pdf' });
      },
      rebuild: () => {
        rebuilt = true;
        return jsonResponse({ chunks: 2 });
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginWithoutReady(user);

    await user.upload(screen.getByTestId('cv-file'), pdfFile());
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-error')).toHaveTextContent(
        'Nao foi possivel extrair texto',
      );
    });
    expect(screen.getByTestId('cv-retry')).toBeInTheDocument();
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(screen.queryByTestId('cv-ready')).not.toBeInTheDocument();

    failUpload = false;
    await user.click(screen.getByTestId('cv-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-ready')).toBeInTheDocument();
    });
    expect(harness.uploadCalls).toBe(2);
    expect(harness.rebuildCalls).toBe(1);
  });

  it('4. erro de embeddings permite retry so do rebuild', async () => {
    let failRebuild = true;
    let uploaded = false;
    let rebuilt = false;
    const harness = createHarness({
      status: () => ({
        ...baseStatus,
        has_cv: uploaded,
        has_embeddings: rebuilt,
      }),
      upload: () => {
        uploaded = true;
        return jsonResponse({ filename: 'cv.pdf' });
      },
      rebuild: () => {
        if (failRebuild) {
          return jsonResponse(
            {
              detail:
                'Nao foi possivel gerar chunks validos para o curriculo enviado',
            },
            400,
          );
        }
        rebuilt = true;
        return jsonResponse({ chunks: 5 });
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginWithoutReady(user);

    await user.upload(screen.getByTestId('cv-file'), pdfFile());
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-error')).toHaveTextContent(
        'Nao foi possivel gerar chunks validos',
      );
    });
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(1);

    failRebuild = false;
    await user.click(screen.getByTestId('cv-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-ready')).toBeInTheDocument();
    });
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(2);
    await user.type(
      screen.getByTestId('processar-texto'),
      'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
    );
    expect(screen.getByTestId('processar-submit')).toBeEnabled();
  });

  it('5. Analisar vaga segue so has_embeddings do status, nao has_cv local', async () => {
    const harness = createHarness({
      status: {
        ...baseStatus,
        has_cv: true,
        has_embeddings: false,
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginWithoutReady(user);

    await waitFor(() => {
      expect(screen.getByTestId('cv-missing')).toHaveTextContent(
        'embeddings ainda nao estao prontos',
      );
    });
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(screen.getByTestId('processar-gate')).toHaveTextContent(
      'Embeddings ainda nao estao prontos',
    );
    expect(screen.queryByTestId('cv-ready')).not.toBeInTheDocument();
  });
});
