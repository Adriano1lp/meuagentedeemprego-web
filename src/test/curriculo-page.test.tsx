import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createHarness(options: {
  hasCv?: boolean;
  upload?: () => Response | Promise<Response>;
  rebuild?: () => Response | Promise<Response>;
}) {
  let hasCv = options.hasCv ?? true;
  let uploadCalls = 0;
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
        has_cv: hasCv,
        has_embeddings: hasCv,
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
      uploadCalls += 1;
      expect(init?.body).toBeInstanceOf(FormData);
      expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
      return (
        (await options.upload?.()) ??
        jsonResponse({
          filename: 'cv.pdf',
          updated_at: '2026-11-02T15:04:00Z',
          has_cv: true,
          has_embeddings: true,
          ready_for_analysis: true,
          cv_file: '/segredo/cv.txt',
          original_file: '/segredo/original.pdf',
          object_key: 'users/1/cv.pdf',
        })
      );
    }
    if (url.includes('/users/me/rebuild-embeddings')) {
      rebuildCalls += 1;
      expect(init?.body).toBeUndefined();
      return (await options.rebuild?.()) ?? jsonResponse({ chunks: 2 });
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
    markCv: () => {
      hasCv = true;
    },
    get uploadCalls() {
      return uploadCalls;
    },
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

async function openCurriculo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await waitFor(() => {
    expect(screen.getByTestId('home-shell')).toBeInTheDocument();
  });
  await user.click(screen.getByTestId('nav-curriculo'));
  await waitFor(() => {
    expect(screen.getByTestId('curriculo-page')).toBeInTheDocument();
  });
}

function chooseFile(file: File) {
  fireEvent.change(screen.getByTestId('cv-file'), {
    target: { files: [file] },
  });
}

describe('troca de curriculo', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('sucesso mostra filename e updated_at só na sessão', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      hasCv: true,
      upload: () => gate,
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openCurriculo(user);

    expect(screen.getByTestId('cv-sent')).toHaveTextContent('Currículo enviado');
    expect(screen.queryByText(/nesta sessão/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('cv-saved-filename')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('cv-replace'));
    chooseFile(new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }));

    fireEvent.click(screen.getByTestId('cv-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('cv-processing')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'processando');
    release(
      jsonResponse({
        filename: 'cv.pdf',
        updated_at: '2026-11-02T15:04:00Z',
        has_cv: true,
        has_embeddings: true,
        ready_for_analysis: true,
        cv_file: '/segredo/cv.txt',
        original_file: '/segredo/original.pdf',
        object_key: 'users/1/cv.pdf',
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('cv-saved-filename')).toHaveTextContent(
        'Currículo atualizado. Nome do arquivo: cv.pdf',
      );
    });
    expect(screen.getByTestId('cv-saved-updated-at')).toHaveTextContent(
      'Atualizado em 02/11/2026 às 12h04',
    );
    expect(screen.getByTestId('cv-sent')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/object_key|original_file|\/segredo\//);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(0);
  });

  it('ready_for_analysis false entra em erro e o retry chama rebuild', async () => {
    let rebuilt = false;
    const harness = createHarness({
      hasCv: true,
      upload: () =>
        jsonResponse({
          filename: 'cv.pdf',
          updated_at: '2026-11-02T15:04:00Z',
          has_cv: true,
          has_embeddings: false,
          ready_for_analysis: false,
          cv_file: '/segredo/cv.txt',
          object_key: 'users/1/key',
        }),
      rebuild: () => {
        rebuilt = true;
        return jsonResponse({
          user_id: 'user-1',
          embedding_run_id: 'run-1',
          chunks: 3,
          processed_at: '2026-11-02T15:04:00Z',
          embedding_model: 'text-embedding-3-small',
          chroma_dir: '/segredo/chroma',
          vector_store: 'mongodb',
          cv_file: '/segredo/cv.txt',
        });
      },
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openCurriculo(user);
    await user.click(screen.getByTestId('cv-replace'));
    chooseFile(new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'erro');
    });
    expect(screen.getByTestId('cv-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('cv-saved-filename')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/object_key|\/segredo\//);
    expect(harness.rebuildCalls).toBe(0);

    await user.click(screen.getByTestId('cv-retry'));
    await waitFor(() => {
      expect(rebuilt).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId('cv-saved-filename')).toHaveTextContent(
        'Currículo atualizado. Nome do arquivo: cv.pdf',
      );
    });
    expect(harness.uploadCalls).toBe(1);
    expect(harness.rebuildCalls).toBe(1);
    expect(document.body.textContent).not.toMatch(
      /chroma_dir|vector_store|cv_file|mongodb|\/segredo\//,
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('400 mostra o detalhe e o retry nao chama rebuild', async () => {
    const harness = createHarness({
      hasCv: false,
      upload: () =>
        jsonResponse(
          { detail: 'Formato de arquivo invalido. Envie um arquivo .txt ou .pdf' },
          400,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await openCurriculo(user);

    expect(screen.getByTestId('cv-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('cv-sent')).not.toBeInTheDocument();
    chooseFile(new File(['PK'], 'cv.docx', { type: 'application/octet-stream' }));
    await user.click(screen.getByTestId('cv-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('cv-error')).toHaveTextContent(
        'Não conseguimos ler esse arquivo. Envie um PDF ou TXT com texto.',
      );
    });
    expect(screen.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'erro');
    expect(harness.rebuildCalls).toBe(0);

    await user.click(screen.getByTestId('cv-retry'));
    await waitFor(() => {
      expect(harness.uploadCalls).toBe(2);
    });
    expect(harness.rebuildCalls).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });
});
