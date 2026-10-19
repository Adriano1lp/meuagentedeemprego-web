import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';

const vagaTexto =
  'Vaga para desenvolvedor Python com requisitos e responsabilidades.';

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
  processarCalls: number;
  pathCalls: string[];
};

function createHarness(options: {
  status?: unknown | (() => unknown);
  upload?: (file: File | null) => Response;
  rebuild?: () => Promise<Response> | Response;
}): Harness {
  let uploadCalls = 0;
  let rebuildCalls = 0;
  let processarCalls = 0;
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
      const uploaded = (init?.body as FormData).get('file');
      const file = uploaded instanceof File ? uploaded : null;
      return (
        options.upload?.(file) ??
        jsonResponse({
          filename: file?.name ?? 'cv.pdf',
          bytes_received: file?.size ?? 0,
          updated_at: '2026-09-14T12:00:00+00:00',
        })
      );
    }
    if (url.includes('/users/me/rebuild-embeddings')) {
      pathCalls.push('rebuild-embeddings');
      rebuildCalls += 1;
      expect(init?.method).toBe('POST');
      return (
        options.rebuild?.() ??
        jsonResponse({
          chunks: 3,
          processed_at: '2026-09-14T12:01:00+00:00',
          embedding_model: 'text-embedding-3-small',
        })
      );
    }
    if (url.endsWith('/processar')) {
      processarCalls += 1;
      return jsonResponse({ texto_resposta: 'nao deveria processar' });
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
    get processarCalls() {
      return processarCalls;
    },
  };
}

async function loginHome(user: ReturnType<typeof userEvent.setup>) {
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
    <MemoryRouter initialEntries={['/entrar']}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function pdfFile(): File {
  return new File(['%PDF-1.4 mae'], 'cv.pdf', { type: 'application/pdf' });
}

function docxFile(): File {
  return new File(['PK fake'], 'cv.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function emptyPdf(): File {
  return new File([], 'cv.pdf', { type: 'application/pdf' });
}

function chooseFile(file: File) {
  fireEvent.change(screen.getByTestId('cv-file'), {
    target: { files: [file] },
  });
}

describe('BDD W-CV', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. Happy PDF: upload sincrono ready_for_analysis libera Analisar sem rebuild', async () => {
    let uploaded = false;
    const harness = createHarness({
      status: () => ({
        ...baseStatus,
        has_cv: uploaded,
        has_embeddings: uploaded,
      }),
      upload: () => {
        uploaded = true;
        return jsonResponse({
          filename: 'cv.pdf',
          bytes_received: 12,
          updated_at: '2026-09-14T12:00:00+00:00',
          has_cv: true,
          has_embeddings: true,
          ready_for_analysis: true,
        });
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginHome(user);

    expect(screen.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'idle');
    expect(screen.getByTestId('cv-create-form')).toBeDisabled();
    expect(screen.getByTestId('cv-create-form-soon')).toHaveTextContent('em breve');
    chooseFile(pdfFile());
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('cv-onboarding')).not.toBeInTheDocument();
    });
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(0);
    await user.type(screen.getByTestId('processar-texto'), vagaTexto);
    expect(screen.getByTestId('processar-submit')).toBeEnabled();
  });

  it('2. Invalid format: .docx ou vazio → API 400 → UI erro → Analisar disabled', async () => {
    const harness = createHarness({
      upload: (file) => {
        if (!file || file.size <= 0) {
          return jsonResponse({ detail: 'Arquivo enviado esta vazio' }, 400);
        }
        if (!file.name.toLowerCase().endsWith('.pdf') && !file.name.toLowerCase().endsWith('.txt')) {
          return jsonResponse(
            {
              detail: 'Formato de arquivo invalido. Envie um arquivo .txt ou .pdf',
            },
            400,
          );
        }
        return jsonResponse({ filename: file.name, bytes_received: file.size });
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginHome(user);

    chooseFile(docxFile());
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('cv-error')).toHaveTextContent(
        'Não conseguimos ler esse arquivo. Envie um PDF ou TXT com texto.',
      );
    });
    expect(screen.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'erro');
    expect(screen.getByTestId('cv-retry')).toBeInTheDocument();
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(harness.rebuildCalls).toBe(0);

    chooseFile(emptyPdf());
    await user.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expect(harness.uploadCalls).toBe(2);
    });
    expect(screen.getByTestId('cv-error')).toHaveTextContent(
      'Não conseguimos ler esse arquivo. Envie um PDF ou TXT com texto.',
    );
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(screen.queryByTestId('cv-ready')).not.toBeInTheDocument();
  });

  it('3. ready_for_analysis false mostra erro e o retry chama rebuild sem reenviar', async () => {
    const harness = createHarness({
      upload: () =>
        jsonResponse({
          filename: 'cv.pdf',
          bytes_received: 12,
          updated_at: '2026-09-14T12:00:00+00:00',
          has_cv: true,
          has_embeddings: false,
          ready_for_analysis: false,
          reason: 'Nao foi possivel gerar chunks validos para o curriculo enviado',
        }),
      rebuild: () =>
        jsonResponse(
          {
            detail: 'Nao foi possivel gerar chunks validos para o curriculo enviado',
          },
          400,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginHome(user);

    chooseFile(pdfFile());
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-error')).toHaveTextContent(
        'Não conseguimos processar seu currículo. Tente de novo.',
      );
    });
    expect(screen.getByTestId('cv-retry')).toBeInTheDocument();
    expect(screen.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'erro');
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(0);

    await user.click(screen.getByTestId('cv-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('cv-error')).toBeInTheDocument();
    });
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(1);
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
  });

  it('4. Com CV o inicio mostra a analise e nao o card de envio', async () => {
    const harness = createHarness({
      status: {
        ...baseStatus,
        has_cv: true,
        has_embeddings: true,
        generated_files: 1,
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await user.type(screen.getByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('processar-panel')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('cv-onboarding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cv-panel')).not.toBeInTheDocument();
    expect(harness.uploadCalls).toBe(0);
    expect(harness.rebuildCalls).toBe(0);
    await user.type(screen.getByTestId('processar-texto'), vagaTexto);
    expect(screen.getByTestId('processar-submit')).toBeEnabled();
  });

  it('5. No CV / has_embeddings false: texto da vaga preenchido → Analisar disabled', async () => {
    const harness = createHarness({
      status: {
        ...baseStatus,
        has_cv: false,
        has_embeddings: false,
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await loginHome(user);

    await waitFor(() => {
      expect(screen.getByTestId('cv-onboarding')).toBeInTheDocument();
    });
    expect(screen.getByTestId('processar-gate')).toHaveTextContent(
      'Envie um currículo para liberar a análise de vaga.',
    );
    await user.type(screen.getByTestId('processar-texto'), vagaTexto);
    expect(screen.getByTestId('processar-texto')).toHaveValue(vagaTexto);
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    await user.click(screen.getByTestId('processar-submit'));
    expect(harness.processarCalls).toBe(0);
  });
});
