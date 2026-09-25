import { expect, test } from '@playwright/test';

import {
  mockAuthSuccess,
  mockCoverLetter,
  mockGapHistory,
  mockLegalRoutes,
  mockUserFile,
  mockedHistoryItem,
  mockedPdfBytes,
} from './helpers';

const letterText = 'Ola, equipe da Acme.\nTenho interesse na vaga.\n\nAtenciosamente.';

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('C1-C3 gera, copia e baixa a carta com Bearer', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const coverPosts: Array<{ empresa: unknown; authorization?: string; userId?: string }> =
    [];
  const fileGets: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/users/me/cover-letter')) {
      const body = request.postDataJSON() as { empresa?: unknown };
      coverPosts.push({
        empresa: body.empresa,
        authorization: request.headers().authorization,
        userId: request.headers()['x-user-id'],
      });
    }
    if (request.url().includes('/users/me/files/')) {
      fileGets.push(request.url());
      expect(request.headers().authorization).toBe('Bearer jwt-login');
      expect(request.headers()['x-user-id']).toBeUndefined();
      expect(request.url()).not.toContain('jwt-login');
      expect(request.url()).not.toContain('token=');
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    body: {
      items: [
        mockedHistoryItem,
        {
          ...mockedHistoryItem,
          id: '2',
          job_title: 'Analise sem empresa',
          company_name: null,
        },
      ],
      limit: 20,
      offset: 0,
    },
  }));
  await mockCoverLetter(page, (empresa) => ({
    body: {
      texto_resposta: letterText,
      pdf_url: '/users/me/files/carta-acme.pdf',
      user_id: 'user-1',
      empresa,
    },
  }));
  await mockUserFile(page, { body: mockedPdfBytes });

  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();
  await expect(page.getByTestId('history-list')).toBeVisible();

  const cards = page.getByTestId('history-item');
  await expect(cards).toHaveCount(2);
  const missing = cards.nth(1).getByTestId('cover-letter-generate');
  await expect(missing).toBeDisabled();
  await expect(cards.nth(1).getByTestId('cover-letter-missing-company')).toBeVisible();

  const generate = cards.nth(0).getByTestId('cover-letter-generate');
  await generate.click();
  await expect(page.getByTestId('cover-letter-text')).toHaveText(letterText);
  expect(coverPosts).toEqual([
    { empresa: 'Acme', authorization: 'Bearer jwt-login', userId: undefined },
  ]);

  await page.getByTestId('cover-letter-copy').click();
  await expect(page.getByTestId('cover-letter-copy-status')).toHaveText(
    'Carta copiada.',
  );
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(letterText);

  await page.getByTestId('cover-letter-download').click();
  await expect(page.getByTestId('cover-letter-download-success')).toBeVisible();
  expect(fileGets.some((url) => url.includes('/users/me/files/carta-acme.pdf'))).toBe(
    true,
  );
  await expect(page.getByTestId('history-list')).toBeVisible();
});

test('C4 500 mantem o historico e tentar de novo gera a carta', async ({ page }) => {
  let attempts = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    body: { items: [mockedHistoryItem], limit: 20, offset: 0 },
  }));
  await mockCoverLetter(page, () => {
    attempts += 1;
    if (attempts === 1) {
      return {
        status: 500,
        body: {
          detail: 'File "/app/main.py" POST /users/me/cover-letter',
        },
      };
    }
    return {
      body: {
        texto_resposta: letterText,
        pdf_url: '/users/me/files/carta-acme.pdf',
        user_id: 'user-1',
      },
    };
  });

  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();
  await page.getByTestId('cover-letter-generate').click();
  await expect(page.getByTestId('cover-letter-error')).toContainText(
    'Nao foi possivel gerar a carta.',
  );
  await expect(page.getByTestId('cover-letter-error')).not.toContainText('/users/me');
  await expect(page.getByTestId('history-item-title')).toHaveText(
    'Desenvolvedor Flutter',
  );
  await page.getByTestId('cover-letter-retry').click();
  await expect(page.getByTestId('cover-letter-text')).toHaveText(letterText);
});

test('C6 429 mostra limite sem CTA de pagamento', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    body: { items: [mockedHistoryItem], limit: 20, offset: 0 },
  }));
  await mockCoverLetter(page, () => ({
    status: 429,
    body: {
      detail: 'Assine em https://billing.example/checkout',
    },
  }));

  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();
  await page.getByTestId('cover-letter-generate').click();
  const quota = page.getByTestId('cover-letter-quota');
  await expect(quota).toContainText('Limite de uso atingido.');
  await expect(quota).not.toContainText('Assine');
  await expect(quota).not.toContainText('checkout');
  await expect(quota.locator('a, button')).toHaveCount(0);
  await expect(page.getByTestId('history-list')).toBeVisible();
});

test('C7 sem sessao /historico volta ao login', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await page.goto('/historico');
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page.getByTestId('cover-letter-generate')).toHaveCount(0);
});
