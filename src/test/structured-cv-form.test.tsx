import type { ComponentProps } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import {
  CV_FORM_CONSENT_TEXT,
  CV_FORM_LEAVE,
  CV_FORM_OFFLINE,
  CV_FORM_PREPARING,
  CV_FORM_RATE_LIMIT,
  CV_FORM_READY,
  CV_FORM_REPLACE,
  CV_FORM_SAVED_LABEL,
  setStructuredCvTimingForTests,
  type CvFormDraft,
} from '../api/structuredCv';
import { CV_STRUCTURED_CONSENT_VERSION } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { BillingReturnProvider } from '../billing/BillingReturn';
import { CvFormWizard } from '../components/CvFormWizard';
import { AuthPage } from '../pages/AuthPage';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ana Silva',
  email: 'ana@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function resumo(): string {
  return 'Atuação com entrega contínua de resultados reais para a operação. '.repeat(6);
}

function validDraft(): CvFormDraft {
  return {
    nome: 'Ana Silva',
    cidade: 'Campinas',
    uf: 'SP',
    modalidade: 'remoto',
    telefone: '11987654321',
    cargosAlvo: ['Analista de dados'],
    senioridade: 'pleno',
    resumo: resumo(),
    primeiroEmprego: true,
    experiencias: [],
    formacoes: [],
    cursos: [],
    habilidadesTecnicas: ['Python', 'SQL', 'ETL'],
    habilidadesComportamentais: [],
    idiomas: [],
    links: [],
    consentimento: true,
  };
}

const savedBody = {
  version: 2,
  document_id: 'doc-secreto',
  has_cv: true,
  has_embeddings: true,
  ready_for_analysis: true,
  reason: 'motivo-secreto',
  cv_file: '/segredo/cv.txt',
  object_key: 'users/1/key',
};

function renderWizard(
  fetchImpl: typeof fetch,
  props: Partial<ComponentProps<typeof CvFormWizard>> = {},
) {
  return render(
    <MemoryRouter initialEntries={['/entrar']}>
      <BillingReturnProvider>
        <AuthProvider fetchImpl={fetchImpl}>
          <Routes>
            <Route path="/entrar" element={<AuthPage />} />
            <Route
              path="/app"
              element={
                <>
                  <CvFormWizard
                    mode="create"
                    email="ana@example.com"
                    initialDraft={validDraft()}
                    replaceOnSave={false}
                    onCancel={() => undefined}
                    {...props}
                  />
                  <Link to="/app/perfil">Ir ao perfil</Link>
                </>
              }
            />
            <Route path="/app/perfil" element={<p>pagina perfil</p>} />
          </Routes>
        </AuthProvider>
      </BillingReturnProvider>
    </MemoryRouter>,
  );
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByTestId('login-email'), 'ana@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await screen.findByTestId('cv-form');
}

async function goToReview(user: ReturnType<typeof userEvent.setup>) {
  for (let step = 0; step < 8; step += 1) {
    await user.click(screen.getByTestId('cv-form-next'));
  }
  await waitFor(() => {
    expect(screen.getByTestId('cv-form-step')).toHaveAttribute('data-step', 'revisao');
  });
}

function authFetch(
  onStructured: (method: string, body: unknown) => Response | Promise<Response>,
  onStatus?: () => Response,
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/login')) {
      return json({ access_token: 'jwt-login', token_type: 'bearer', user: userBody });
    }
    if (url.includes('/auth/me')) {
      return json(userBody);
    }
    if (url.includes('/users/me/status')) {
      return onStatus?.() ?? json({ has_cv: true, has_embeddings: true });
    }
    if (url.includes('/users/me/cv/structured')) {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
      return onStructured(init?.method ?? 'GET', body);
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', { status: 200, headers: { 'Content-Type': 'text/markdown' } });
    }
    return json({ detail: 'ausente' }, 404);
  });
}

describe('formulário de currículo', () => {
  beforeEach(() => {
    setStructuredCvTimingForTests({
      getRetryDelaysMs: [0, 0, 0],
      pollDelaysMs: [0, 0, 0],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('trava o botão no envio e mostra pronto sem campos técnicos', async () => {
    let release: (response: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    renderWizard(authFetch(() => gate));
    await login(user);
    await goToReview(user);
    await user.click(screen.getByTestId('cv-form-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('cv-form-submit')).toBeDisabled();
    });
    expect(screen.getByTestId('cv-form-submit')).toHaveAttribute('aria-busy', 'true');
    release(json(savedBody, 201));
    expect(await screen.findByTestId('cv-form-ready')).toHaveTextContent(CV_FORM_READY);
    expect(screen.getByTestId('cv-form-saved-label')).toHaveTextContent(CV_FORM_SAVED_LABEL);
    expect(document.body.textContent).not.toMatch(
      /motivo-secreto|doc-secreto|cv_file|object_key|\/segredo\/|cv-estruturado-v1/,
    );
  });

  it('422 devolve ao passo do campo', async () => {
    const user = userEvent.setup();
    renderWizard(
      authFetch(() =>
        json(
          {
            detail: [{ type: 'value_error', loc: ['body', 'resumo'], msg: 'tamanho invalido' }],
          },
          422,
        ),
      ),
    );
    await login(user);
    await goToReview(user);
    await user.click(screen.getByTestId('cv-form-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('cv-form-step')).toHaveAttribute('data-step', 'resumo');
    });
    expect(screen.getByTestId('cv-resumo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('cv-resumo')).toHaveAttribute('aria-describedby', expect.stringContaining('cv-resumo-error'));
    expect(document.activeElement).toBe(screen.getByTestId('cv-resumo'));
    expect(screen.getByTestId('cv-resumo')).toHaveValue(resumo());
  });

  it('429 com Retry-After não perde o rascunho', async () => {
    let calls = 0;
    const user = userEvent.setup();
    renderWizard(
      authFetch(() => {
        calls += 1;
        if (calls === 1) {
          return json({ detail: 'Muitas alteracoes do CV estruturado' }, 429, {
            'Retry-After': '1',
          });
        }
        return json(savedBody, 201);
      }),
    );
    await login(user);
    await goToReview(user);
    await user.click(screen.getByTestId('cv-form-submit'));
    expect(await screen.findByTestId('cv-form-error')).toHaveTextContent('Aguarde 1 segundo');
    expect(screen.getByTestId('cv-form-retry')).toBeDisabled();
    await user.click(screen.getByTestId('cv-form-back'));
    await user.click(screen.getByTestId('cv-form-back'));
    await user.click(screen.getByTestId('cv-form-back'));
    await user.click(screen.getByTestId('cv-form-back'));
    await user.click(screen.getByTestId('cv-form-back'));
    await user.click(screen.getByTestId('cv-form-back'));
    await user.click(screen.getByTestId('cv-form-back'));
    await user.click(screen.getByTestId('cv-form-back'));
    expect(screen.getByTestId('cv-nome')).toHaveValue('Ana Silva');
    await waitFor(
      () => {
        expect(screen.getByTestId('cv-form-retry')).toBeEnabled();
      },
      { timeout: 2500 },
    );
    await user.click(screen.getByTestId('cv-form-retry'));
    expect(await screen.findByTestId('cv-form-ready')).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('POST 409 faz fallback para PUT com o mesmo corpo', async () => {
    const calls: { method: string; body: { consentimento?: { versao_termo?: string } } }[] = [];
    const user = userEvent.setup();
    renderWizard(
      authFetch((method, body) => {
        calls.push({
          method,
          body: body as { consentimento?: { versao_termo?: string } },
        });
        if (method === 'POST') {
          return json({ detail: 'CV estruturado ja existe' }, 409);
        }
        return json(savedBody, 200);
      }),
    );
    await login(user);
    await goToReview(user);
    await user.click(screen.getByTestId('cv-form-submit'));
    const dialog = await screen.findByTestId('cv-replace-dialog');
    expect(dialog).toHaveAttribute('role', 'alertdialog');
    expect(dialog).toHaveTextContent(CV_FORM_REPLACE);
    expect(calls.map((call) => call.method)).toEqual(['POST']);
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute('data-testid', 'cv-replace-cancel');
    });
    await user.tab();
    expect(document.activeElement).toHaveAttribute('data-testid', 'cv-replace-confirm');
    await user.tab();
    expect(document.activeElement).toHaveAttribute('data-testid', 'cv-replace-cancel');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('cv-replace-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('cv-review')).toHaveTextContent('Ana Silva');
    expect(calls.map((call) => call.method)).toEqual(['POST']);
    await user.click(screen.getByTestId('cv-form-submit'));
    expect(await screen.findByTestId('cv-replace-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('cv-replace-confirm'));
    expect(await screen.findByTestId('cv-form-ready')).toBeInTheDocument();
    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST', 'PUT']);
    expect(calls[0]?.body).toEqual(calls[2]?.body);
    expect(calls[0]?.body.consentimento?.versao_termo).toBe(CV_STRUCTURED_CONSENT_VERSION);
    expect(JSON.stringify(calls[0]?.body)).not.toContain('ana@example.com');
  });

  it('Retry-After enorme ou inválido deixa o retry liberado', async () => {
    const user = userEvent.setup();
    renderWizard(
      authFetch(() =>
        json({ detail: 'limite' }, 429, { 'Retry-After': '99999' }),
      ),
    );
    await login(user);
    await goToReview(user);
    await user.click(screen.getByTestId('cv-form-submit'));
    expect(await screen.findByTestId('cv-form-error')).toHaveTextContent(CV_FORM_RATE_LIMIT);
    expect(screen.getByTestId('cv-form-error')).not.toHaveTextContent('99999');
    expect(screen.getByTestId('cv-form-retry')).toBeEnabled();
    expect(screen.getByTestId('cv-form-submit')).toBeEnabled();
    expect(screen.getByTestId('cv-review')).toHaveTextContent('Ana Silva');
  });

  it('consentimento começa desmarcado, sem link, e bloqueia o envio', async () => {
    const calls: string[] = [];
    const user = userEvent.setup();
    renderWizard(
      authFetch((method) => {
        calls.push(method);
        return json(savedBody, 201);
      }),
      { initialDraft: { ...validDraft(), consentimento: false } },
    );
    await login(user);
    await goToReview(user);
    expect(screen.getByTestId('cv-consent')).not.toBeChecked();
    expect(screen.getByText(CV_FORM_CONSENT_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId('cv-consent').closest('label')?.querySelector('a')).toBeNull();
    await user.click(screen.getByTestId('cv-form-submit'));
    expect(screen.getByTestId('cv-consent')).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toEqual([]);
  });

  it('erro de rede mantém os dados', async () => {
    const user = userEvent.setup();
    renderWizard(
      authFetch(() => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await login(user);
    await goToReview(user);
    await user.click(screen.getByTestId('cv-form-submit'));
    expect(await screen.findByTestId('cv-form-error')).toHaveTextContent(CV_FORM_OFFLINE);
    for (let step = 0; step < 8; step += 1) {
      await user.click(screen.getByTestId('cv-form-back'));
    }
    expect(screen.getByTestId('cv-nome')).toHaveValue('Ana Silva');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('pede confirmação antes de substituir e avisa ao sair com rascunho', async () => {
    const methods: string[] = [];
    const user = userEvent.setup();
    renderWizard(
      authFetch((method) => {
        methods.push(method);
        return json(savedBody, 200);
      }),
      { mode: 'update', replaceOnSave: true, replacedByFile: true },
    );
    await login(user);
    expect(screen.getByTestId('cv-not-current')).toBeInTheDocument();
    expect(screen.queryByTestId('cv-review')).not.toBeInTheDocument();
    await user.clear(screen.getByTestId('cv-nome'));
    await user.type(screen.getByTestId('cv-nome'), 'Ana Lima');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Ir ao perfil' }));
    expect(await screen.findByTestId('cv-leave-dialog')).toHaveTextContent(CV_FORM_LEAVE);
    expect(screen.queryByText('pagina perfil')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('cv-leave-stay'));
    expect(screen.getByTestId('cv-nome')).toHaveValue('Ana Lima');
    await goToReview(user);
    expect(screen.getByTestId('cv-review')).toHaveTextContent('Remoto');
    expect(screen.getByTestId('cv-review')).not.toHaveTextContent(/\bremoto\b/);
    expect(screen.getByTestId('cv-review')).not.toHaveTextContent('cv-estruturado-v1');
    await user.click(screen.getByTestId('cv-form-submit'));
    expect(await screen.findByTestId('cv-replace-dialog')).toHaveTextContent(CV_FORM_REPLACE);
    expect(methods).toEqual([]);
    await user.click(screen.getByTestId('cv-replace-confirm'));
    expect(await screen.findByTestId('cv-form-ready')).toBeInTheDocument();
    expect(methods).toEqual(['PUT']);
    expect(window.localStorage.getItem('mae.cv') ?? '').not.toContain('Ana Lima');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('no início, criar pelo formulário deixa de ser em breve', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/login')) {
        return json({ access_token: 'jwt-login', token_type: 'bearer', user: userBody });
      }
      if (url.includes('/auth/me')) {
        return json(userBody);
      }
      if (url.includes('/users/me/status')) {
        return json({ has_cv: false, has_embeddings: false, has_profile: false });
      }
      if (url.includes('/billing/me')) {
        return json({ plan: 'free', used: 0, limit: 5, remaining: 5, period_end: '2026-12-01T00:00:00Z' });
      }
      if (url.includes('/legal/')) {
        return new Response('# doc', { status: 200, headers: { 'Content-Type': 'text/markdown' } });
      }
      return json({ detail: 'ausente' }, 404);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/entrar']}>
        <AuthProvider fetchImpl={fetchImpl}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.type(await screen.findByTestId('login-email'), 'ana@example.com');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('cv-create-form')).toBeEnabled();
    expect(screen.queryByText('em breve')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('cv-create-form'));
    expect(await screen.findByTestId('cv-form-step')).toHaveAttribute('data-step', 'basico');
    expect(screen.getByTestId('cv-email')).toHaveValue('ana@example.com');
    await user.click(screen.getByTestId('cv-form-next'));
    expect(screen.getByTestId('cv-nome')).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(screen.getByTestId('cv-nome'));
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

const structuredData = {
  identificacao: {
    nome: 'Ana Silva',
    cidade: 'Campinas',
    uf: 'SP',
    modalidade: 'remoto',
    cargos_alvo: ['Analista de dados'],
    senioridade: 'pleno',
  },
  resumo: resumo(),
  primeiro_emprego: true,
  experiencias: [],
  formacoes: [],
  cursos: [],
  habilidades_tecnicas: ['Python', 'SQL', 'ETL'],
  habilidades_comportamentais: [],
  idiomas: [],
  links: [],
};

function renderCurriculo(fetchImpl: typeof fetch) {
  return render(
    <MemoryRouter initialEntries={['/entrar']}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function openCurriculo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByTestId('login-email'), 'ana@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await screen.findByTestId('home-shell');
  await user.click(screen.getByTestId('nav-curriculo'));
  await screen.findByTestId('curriculo-page');
}

describe('editar currículo pelo formulário', () => {
  beforeEach(() => {
    setStructuredCvTimingForTests({ getRetryDelaysMs: [0, 0, 0], pollDelaysMs: [0] });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  function fetchFor(structured: (method: string) => Response | Promise<Response>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/login')) {
        return json({ access_token: 'jwt-login', token_type: 'bearer', user: userBody });
      }
      if (url.includes('/auth/me')) {
        return json(userBody);
      }
      if (url.includes('/users/me/status')) {
        return json({ has_cv: true, has_embeddings: true, has_profile: false });
      }
      if (url.includes('/billing/me')) {
        return json({ plan: 'free', used: 0, limit: 5, remaining: 5 });
      }
      if (url.includes('/users/me/cv/structured')) {
        return structured(init?.method ?? 'GET');
      }
      if (url.includes('/legal/')) {
        return new Response('# doc', { status: 200, headers: { 'Content-Type': 'text/markdown' } });
      }
      return json({ detail: 'ausente' }, 404);
    });
  }

  it('GET 200 abre preenchido e is_current false avisa a troca', async () => {
    const user = userEvent.setup();
    renderCurriculo(
      fetchFor(() =>
        json({
          version: 3,
          email: 'ana@example.com',
          is_current: false,
          document_id: 'doc-x',
          data: structuredData,
          consent: { versao_termo: CV_STRUCTURED_CONSENT_VERSION, accepted_at: '2026-11-01T00:00:00Z' },
        }),
      ),
    );
    await openCurriculo(user);
    await user.click(screen.getByTestId('cv-edit-form'));
    expect(await screen.findByTestId('cv-nome')).toHaveValue('Ana Silva');
    expect(screen.getByTestId('cv-not-current')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/doc-x|cv-estruturado-v1/);
  });

  it('GET 404 abre vazio', async () => {
    const user = userEvent.setup();
    renderCurriculo(fetchFor(() => json({ detail: 'CV estruturado nao encontrado' }, 404)));
    await openCurriculo(user);
    await user.click(screen.getByTestId('cv-edit-form'));
    expect(await screen.findByTestId('cv-nome')).toHaveValue('');
    expect(screen.queryByTestId('cv-not-current')).not.toBeInTheDocument();
  });

  it('GET 409 insiste e depois abre preenchido', async () => {
    let gets = 0;
    let release: (response: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    renderCurriculo(
      fetchFor(() => {
        gets += 1;
        if (gets < 3) {
          return json({ detail: 'CV estruturado ainda nao esta disponivel' }, 409);
        }
        return gate;
      }),
    );
    await openCurriculo(user);
    await user.click(screen.getByTestId('cv-edit-form'));
    expect(await screen.findByTestId('cv-form-preparing')).toHaveTextContent(CV_FORM_PREPARING);
    release(
      json({
        email: 'ana@example.com',
        is_current: true,
        data: structuredData,
      }),
    );
    expect(await screen.findByTestId('cv-nome')).toHaveValue('Ana Silva');
    expect(gets).toBe(3);
  });

  it('GET 409 persistente mostra opção de criar', async () => {
    const user = userEvent.setup();
    renderCurriculo(
      fetchFor(() => json({ detail: 'CV estruturado ainda nao esta disponivel' }, 409)),
    );
    await openCurriculo(user);
    await user.click(screen.getByTestId('cv-edit-form'));
    expect(await screen.findByTestId('cv-structured-unavailable')).toBeInTheDocument();
    await user.click(screen.getByTestId('cv-structured-create'));
    expect(await screen.findByTestId('cv-nome')).toHaveValue('');
  });
});
