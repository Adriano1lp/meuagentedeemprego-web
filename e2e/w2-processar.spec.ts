import { expect, test } from '@playwright/test';

import {
  mockAuthSuccess,
  mockLegalRoutes,
  mockOutdatedMe,
  mockProcessar,
  mockedPdfUrl,
  mockedStatus,
  mockUserFile,
  mockUserStatus,
} from './helpers';

const vagaTexto =
  'Vaga para desenvolvedor Python com requisitos, responsabilidades e experiencia.';

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('1. Status UI reflete so GET /users/me/status', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    plan: 'essencial',
    used: 4,
    limit: 30,
    remaining: 26,
    period: '2026-09',
  });
  await page.goto('/');
  await login(page);

  await expect(page.getByTestId('status-card')).toBeVisible();
  await expect(page.getByTestId('status-plan')).toHaveText('Essencial');
  await expect(page.getByTestId('status-quota')).toContainText(
    '4 de 30 analises usadas',
  );
  await expect(page.getByTestId('status-quota')).toContainText('26 restantes');
  await expect(page.getByTestId('status-period')).toHaveText('2026-09');
});

test('2. processar sucesso: pdf_url, download %PDF e refresh de status', async ({
  page,
}) => {
  let used = 1;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, () => ({
    ...mockedStatus,
    used,
    remaining: 5 - used,
  }));
  await mockProcessar(page, (texto) => {
    expect(texto).toBe(vagaTexto);
    used = 2;
    return {
      body: {
        texto_resposta: 'Analise ok',
        pdf_url: mockedPdfUrl,
        match_score: 80,
        pdf_generated: true,
        generation_blocked: false,
      },
    };
  });
  await mockUserFile(page);

  const fileRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/users/me/files/')) {
      fileRequests.push(request.url());
      expect(request.headers().authorization).toBe('Bearer jwt-login');
    }
  });

  await page.goto('/');
  await login(page);
  await expect(page.getByTestId('status-quota')).toContainText(
    '1 de 5 analises usadas',
  );

  await page.getByTestId('processar-texto').fill(vagaTexto);
  const processarRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/processar') && request.method() === 'POST',
  );
  await page.getByTestId('processar-submit').click();
  const sent = await processarRequest;
  expect(sent.postDataJSON()).toEqual({ texto: vagaTexto });

  await expect(page.getByTestId('processar-success')).toBeVisible();
  await expect(page.getByTestId('download-pdf')).toBeVisible();
  await page.getByTestId('download-pdf').click();
  await expect(page.getByTestId('pdf-download-success')).toBeVisible();
  expect(fileRequests.some((url) => url.includes('/users/me/files/abc-123.pdf'))).toBe(
    true,
  );
  await expect(page.getByTestId('status-quota')).toContainText(
    '2 de 5 analises usadas',
  );
});

test('3. generation_blocked nao oferece PDF', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockProcessar(page, () => ({
    body: {
      texto_resposta: 'Aderencia baixa',
      pdf_url: null,
      match_score: 18,
      pdf_generated: false,
      generation_blocked: true,
      blocked_reason: 'low_match_score',
    },
  }));
  await page.goto('/');
  await login(page);

  await page.getByTestId('processar-texto').fill(vagaTexto);
  await page.getByTestId('processar-submit').click();
  await expect(page.getByTestId('processar-blocked')).toBeVisible();
  await expect(page.getByTestId('download-pdf')).toHaveCount(0);
  await expect(page.getByTestId('pdf-download-success')).toHaveCount(0);
});

test('4. 402 bloqueia sem loop e sem queimar cota local', async ({ page }) => {
  let processarHits = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockProcessar(page, () => {
    processarHits += 1;
    return {
      status: 402,
      body: {
        detail: {
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'Cota gratuita do mes esgotada.',
          used: 5,
          limit: 5,
          plan: 'free',
        },
      },
    };
  });
  await page.goto('/');
  await login(page);
  await expect(page.getByTestId('status-quota')).toContainText(
    '1 de 5 analises usadas',
  );

  await page.getByTestId('processar-texto').fill(vagaTexto);
  await page.getByTestId('processar-submit').click();
  await expect(page.getByTestId('quota-block')).toContainText(
    'Cota gratuita do mes esgotada.',
  );
  await expect(page.getByTestId('processar-success')).toHaveCount(0);
  await expect(page.getByTestId('status-quota')).toContainText(
    '1 de 5 analises usadas',
  );
  expect(processarHits).toBe(1);
});

test('5. 400 mostra erro e nao UI de sucesso', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockProcessar(page, () => ({
    status: 400,
    body: {
      detail:
        'Embeddings do usuario nao encontrados. Envie o curriculo e execute POST /users/me/rebuild-embeddings antes de processar a vaga.',
    },
  }));
  await page.goto('/');
  await login(page);

  await page.getByTestId('processar-texto').fill(vagaTexto);
  await page.getByTestId('processar-submit').click();
  await expect(page.getByTestId('processar-error')).toContainText(
    'Embeddings do usuario nao encontrados',
  );
  await expect(page.getByTestId('processar-success')).toHaveCount(0);
  await expect(page.getByTestId('download-pdf')).toHaveCount(0);
});

test('6. sem JWT ou 403 OUTDATED nao acessa status/processar', async ({
  page,
}) => {
  const forbidden: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/users/me/status') || url.includes('/processar')) {
      forbidden.push(url);
    }
  });

  await mockLegalRoutes(page);
  await page.goto('/');
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page.getByTestId('status-card')).toHaveCount(0);
  await expect(page.getByTestId('processar-submit')).toHaveCount(0);
  expect(forbidden).toEqual([]);

  await mockOutdatedMe(page);
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('consent-gate')).toBeVisible();
  expect(forbidden).toEqual([]);
});
