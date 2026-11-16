import { expect, test, type Page } from './fixtures';

import {
  mockAuthSuccess,
  mockLegalRoutes,
  mockedStatus,
  mockUserStatus,
} from './helpers';

const RESUMO =
  'Atuação com entrega contínua de resultados reais para a operação. '.repeat(6);

const CONSENT_TEXT =
  'Autorizo o Meu Agente de Emprego a usar os dados deste currículo para criar uma representação do meu perfil (embeddings) e para analisar vagas e gerar cartas de apresentação com inteligência artificial, conforme o Termo do currículo estruturado.';

const SEGREDO = 'motivo-interno-de-embedding';

async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth + 1;
  });
  expect(fits).toBe(true);
}

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

async function fillBasico(page: Page) {
  await page.getByTestId('cv-nome').fill('Ana Silva');
  await page.getByTestId('cv-cidade').fill('Campinas');
  await page.getByTestId('cv-uf').selectOption('SP');
  await page.getByTestId('cv-modalidade').selectOption('remoto');
  await page.getByTestId('cv-telefone').fill('11987654321');
  await page.getByTestId('cv-cargos-alvo').fill('Analista de dados');
  await page.getByTestId('cv-cargo-add').click();
  await page.getByTestId('cv-senioridade').selectOption('pleno');
  await page.getByTestId('cv-form-next').click();
}

async function fillResumo(page: Page) {
  await page.getByTestId('cv-resumo').fill(RESUMO);
  await page.getByTestId('cv-form-next').click();
}

async function fillExperiencia(page: Page) {
  await page.getByTestId('cv-exp-0-cargo').fill('Analista de dados');
  await page.getByTestId('cv-exp-0-empresa').fill('Empresa Alfa');
  await page.getByTestId('cv-exp-0-inicio').fill('2020-01');
  await page.getByTestId('cv-exp-0-fim').fill('2024-06');
  await page.getByTestId('cv-exp-0-realizacao-input').fill(
    'Entregou painel de indicadores usado pela operação.',
  );
  await page.getByTestId('cv-exp-0-realizacao-add').click();
  await page.getByTestId('cv-exp-0-realizacao-input').fill(
    'Reduziu retrabalho ao padronizar a extração dos dados.',
  );
  await page.getByTestId('cv-exp-0-realizacao-add').click();
  await page.getByTestId('cv-form-next').click();
}

async function fillPrimeiroEmprego(page: Page) {
  await page.getByTestId('cv-primeiro-emprego').check();
  await page.getByTestId('cv-form-next').click();
}

async function fillSkills(page: Page) {
  for (const skill of ['Python', 'SQL', 'ETL']) {
    await page.getByTestId('cv-habilidades-tecnicas').fill(skill);
    await page.getByTestId('cv-skill-add').click();
  }
  await page.getByTestId('cv-form-next').click();
}

async function throughOptional(page: Page) {
  await page.getByTestId('cv-form-next').click();
  await page.getByTestId('cv-form-next').click();
  await fillSkills(page);
  await page.getByTestId('cv-form-next').click();
  await page.getByTestId('cv-form-next').click();
}

async function reachReview(
  page: Page,
  experience: 'completa' | 'primeiro',
  options: { consent?: boolean } = {},
) {
  await page.getByTestId('cv-create-form').click();
  await expect(page.getByTestId('cv-form-step')).toHaveAttribute('data-step', 'basico');
  await fillBasico(page);
  await fillResumo(page);
  if (experience === 'completa') {
    await fillExperiencia(page);
  } else {
    await fillPrimeiroEmprego(page);
  }
  await throughOptional(page);
  await expect(page.getByTestId('cv-form-step')).toHaveAttribute('data-step', 'revisao');
  await expect(page.getByTestId('cv-consent')).not.toBeChecked();
  await expect(page.getByText(CONSENT_TEXT)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Termo do currículo estruturado' })).toHaveCount(0);
  if (options.consent !== false) {
    await page.getByTestId('cv-consent').check();
  }
}

function savedResponse(ready: boolean) {
  return {
    version: 1,
    document_id: 'doc-secreto',
    has_cv: true,
    has_embeddings: ready,
    ready_for_analysis: ready,
    reason: ready ? undefined : SEGREDO,
    cv_file: '/segredo/cv.txt',
    object_key: 'users/1/key',
    chroma_dir: '/segredo/chroma',
  };
}

test('fluxo feliz, overflow e análise liberada', async ({ page }, testInfo) => {
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  let saved = false;
  let polls = 0;
  const bodies: string[] = [];
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, () => {
    if (saved) {
      polls += 1;
    }
    return {
      ...mockedStatus,
      has_cv: saved,
      has_embeddings: saved && polls >= 2,
    };
  });
  await page.route('**/users/me/cv/structured', async (route) => {
    bodies.push(route.request().postData() ?? '');
    saved = true;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(savedResponse(false)),
    });
  });

  await login(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByTestId('cv-create-form').click();
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('formulario-basico-360.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('formulario-basico-1280.png'),
    fullPage: true,
  });

  await fillBasico(page);
  await fillResumo(page);
  await fillExperiencia(page);
  await throughOptional(page);
  await expect(page.getByTestId('cv-review')).toContainText('Remoto');
  await expect(page.getByTestId('cv-review')).not.toContainText('cv-estruturado-v1');
  for (const width of [360, 1280] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`formulario-revisao-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByTestId('cv-consent').check();
  await page.getByTestId('cv-form-submit').click();
  await expect(page.getByTestId('cv-form-preparing')).toContainText(
    'Estamos preparando seu currículo…',
  );
  await expect(page.getByTestId('cv-form-ready')).toContainText(
    'Pronto! Já pode analisar vagas.',
    { timeout: 15_000 },
  );
  await expect(page.getByTestId('cv-form-saved-label')).toHaveText(
    'Currículo criado pelo formulário',
  );
  await expect(page.getByText(SEGREDO)).toHaveCount(0);
  await expect(page.getByText(/doc-secreto|object_key|cv_file|chroma_dir|structured-cv/)).toHaveCount(0);
  const payload = JSON.parse(bodies[0] ?? '{}') as { email?: string; identificacao?: { telefone?: string } };
  expect(payload.email).toBeUndefined();
  expect(payload.identificacao?.telefone).toBe('11987654321');
  await page.getByTestId('processar-texto').fill(
    'Vaga para analista de dados com requisitos e responsabilidades.',
  );
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
  }));
  expect(stored.local).not.toContain('Ana Silva');
  expect(stored.session).not.toContain('Ana Silva');
  expect(stored.local).not.toContain('jwt-login');
  expect(logs.join('\n')).not.toContain('jwt-login');
  expect(logs.join('\n')).not.toContain(SEGREDO);
});

test('422 volta ao campo do resumo', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, { ...mockedStatus, has_cv: false, has_embeddings: false });
  await page.route('**/users/me/cv/structured', async (route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: [{ type: 'value_error', loc: ['body', 'resumo'], msg: 'tamanho invalido' }],
      }),
    });
  });
  await login(page);
  await reachReview(page, 'primeiro');
  await page.getByTestId('cv-form-submit').click();
  await expect(page.getByTestId('cv-form-step')).toHaveAttribute('data-step', 'resumo');
  await expect(page.getByTestId('cv-resumo')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('cv-resumo')).toHaveValue(RESUMO);
});

test('429 com Retry-After permite retry sem perder dados', async ({ page }) => {
  let calls = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, () => ({
    ...mockedStatus,
    has_cv: calls > 1,
    has_embeddings: calls > 1,
  }));
  await page.route('**/users/me/cv/structured', async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '1' },
        body: JSON.stringify({ detail: 'Muitas alteracoes do CV estruturado' }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(savedResponse(true)),
    });
  });
  await login(page);
  await reachReview(page, 'primeiro');
  await page.getByTestId('cv-form-submit').click();
  await expect(page.getByTestId('cv-form-error')).toContainText('Aguarde 1 segundo');
  await expect(page.getByTestId('cv-review')).toContainText('Ana Silva');
  await expect(page.getByTestId('cv-form-retry')).toBeDisabled();
  await expect(page.getByTestId('cv-form-retry')).toBeEnabled({ timeout: 4000 });
  await page.getByTestId('cv-form-retry').click();
  await expect(page.getByTestId('cv-form-ready')).toBeVisible();
  expect(calls).toBe(2);
});

test('POST 409 faz fallback para PUT', async ({ page }) => {
  const methods: string[] = [];
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, { ...mockedStatus, has_cv: false, has_embeddings: false });
  await page.route('**/users/me/cv/structured', async (route) => {
    methods.push(route.request().method());
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'CV estruturado ja existe' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(savedResponse(true)),
    });
  });
  await login(page);
  await reachReview(page, 'primeiro');
  await page.getByTestId('cv-form-submit').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Isso substitui seu currículo atual');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('cv-review')).toContainText('Ana Silva');
  expect(methods).toEqual(['POST']);
  await page.getByTestId('cv-form-submit').click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('cv-replace-confirm').click();
  await expect(page.getByTestId('cv-form-ready')).toBeVisible();
  expect(methods).toEqual(['POST', 'POST', 'PUT']);
});

test('sem consentimento o envio não sai', async ({ page }) => {
  const methods: string[] = [];
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, { ...mockedStatus, has_cv: false, has_embeddings: false });
  await page.route('**/users/me/cv/structured', async (route) => {
    methods.push(route.request().method());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(savedResponse(true)),
    });
  });
  await login(page);
  await reachReview(page, 'primeiro', { consent: false });
  await page.getByTestId('cv-form-submit').click();
  await expect(page.getByTestId('cv-consent')).toHaveAttribute('aria-invalid', 'true');
  expect(methods).toEqual([]);
});

test('is_current false pede confirmação antes de gravar', async ({ page }) => {
  const methods: string[] = [];
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, { ...mockedStatus, has_cv: true, has_embeddings: true });
  await page.route('**/users/me/cv/structured', async (route) => {
    methods.push(route.request().method());
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'ada@example.com',
          is_current: false,
          data: {
            identificacao: {
              nome: 'Ana Silva',
              cidade: 'Campinas',
              uf: 'SP',
              modalidade: 'hibrido',
              cargos_alvo: ['Analista de dados'],
              senioridade: 'pleno',
            },
            resumo: RESUMO,
            primeiro_emprego: true,
            experiencias: [],
            formacoes: [],
            cursos: [],
            habilidades_tecnicas: ['Python', 'SQL', 'ETL'],
            habilidades_comportamentais: [],
            idiomas: [],
            links: [],
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(savedResponse(true)),
    });
  });
  await login(page);
  await page.getByTestId('nav-curriculo').click();
  await page.getByTestId('cv-edit-form').click();
  await expect(page.getByTestId('cv-not-current')).toBeVisible();
  await expect(page.getByTestId('cv-nome')).toHaveValue('Ana Silva');
  for (let step = 0; step < 8; step += 1) {
    await page.getByTestId('cv-form-next').click();
  }
  await expect(page.getByTestId('cv-consent')).not.toBeChecked();
  await expect(page.getByText(CONSENT_TEXT)).toBeVisible();
  await page.getByTestId('cv-consent').check();
  await page.getByTestId('cv-form-submit').click();
  await expect(page.getByRole('alertdialog')).toContainText('Isso substitui seu currículo atual');
  expect(methods).toEqual(['GET']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('cv-review')).toContainText('Ana Silva');
  expect(methods).toEqual(['GET']);
  await page.getByTestId('cv-form-submit').click();
  await page.getByTestId('cv-replace-confirm').click();
  await expect(page.getByTestId('cv-form-ready')).toBeVisible();
  expect(methods).toEqual(['GET', 'PUT']);
});

test('edição: GET 200, 404 e 409', async ({ page }) => {
  let mode: 'ok' | 'missing' | 'retry' | 'stuck' = 'ok';
  let gets = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, { ...mockedStatus, has_cv: true, has_embeddings: true });
  await page.route('**/users/me/cv/structured', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(savedResponse(true)),
      });
      return;
    }
    gets += 1;
    if (mode === 'missing') {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'CV estruturado nao encontrado' }),
      });
      return;
    }
    if (mode === 'stuck') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'CV estruturado ainda nao esta disponivel' }),
      });
      return;
    }
    if (mode === 'retry' && gets < 2) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'CV estruturado ainda nao esta disponivel' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 4,
        email: 'ada@example.com',
        is_current: false,
        document_id: 'doc-secreto',
        updated_at: '2026-11-01T12:00:00Z',
        data: {
          identificacao: {
            nome: 'Ana Silva',
            cidade: 'Campinas',
            uf: 'SP',
            modalidade: 'hibrido',
            cargos_alvo: ['Analista de dados'],
            senioridade: 'pleno',
          },
          resumo: RESUMO,
          primeiro_emprego: true,
          experiencias: [],
          formacoes: [],
          cursos: [],
          habilidades_tecnicas: ['Python', 'SQL', 'ETL'],
          habilidades_comportamentais: [],
          idiomas: [],
          links: [],
        },
        consent: {
          versao_termo: 'cv-estruturado-v1',
          accepted_at: '2026-11-01T12:00:00Z',
        },
      }),
    });
  });

  await login(page);
  await page.getByTestId('nav-curriculo').click();
  await expect(page.getByTestId('curriculo-page')).toBeVisible();
  await page.getByTestId('cv-edit-form').click();
  await expect(page.getByTestId('cv-nome')).toHaveValue('Ana Silva');
  await expect(page.getByTestId('cv-not-current')).toContainText('veio de um arquivo');
  await expect(page.getByText('doc-secreto')).toHaveCount(0);
  await expect(page.getByText('cv-estruturado-v1')).toHaveCount(0);
  await page.getByTestId('cv-form-back').click();

  mode = 'missing';
  await page.getByTestId('cv-edit-form').click();
  await expect(page.getByTestId('cv-nome')).toHaveValue('');
  await page.getByTestId('cv-form-back').click();

  mode = 'retry';
  gets = 0;
  await page.getByTestId('cv-edit-form').click();
  await expect(page.getByTestId('cv-form-preparing')).toContainText(
    'Estamos preparando seu currículo…',
  );
  await expect(page.getByTestId('cv-nome')).toHaveValue('Ana Silva', { timeout: 8000 });
  await page.getByTestId('cv-form-back').click();

  mode = 'stuck';
  await page.getByTestId('cv-edit-form').click();
  await expect(page.getByTestId('cv-structured-unavailable')).toBeVisible({ timeout: 12_000 });
  await page.getByTestId('cv-structured-create').click();
  await expect(page.getByTestId('cv-nome')).toHaveValue('');
});
