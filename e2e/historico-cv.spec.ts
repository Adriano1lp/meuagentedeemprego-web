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

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

const withCv = {
  ...mockedHistoryItem,
  cv_file_name: 'cv-acme.pdf',
  pdf_url: '/users/me/files/vaga-acme.pdf',
};

const withoutCv = {
  ...mockedHistoryItem,
  id: '2',
  job_title: 'Analise sem arquivo',
  company_name: 'Norte',
  cv_file_name: null,
  pdf_url: null,
};

test('baixa o CV com Bearer e esconde o CTA quando nao ha arquivo', async ({
  page,
}) => {
  const fileGets: Array<{ url: string; authorization?: string; userId?: string }> =
    [];

  page.on('request', (request) => {
    if (request.url().includes('/users/me/files/')) {
      fileGets.push({
        url: request.url(),
        authorization: request.headers().authorization,
        userId: request.headers()['x-user-id'],
      });
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    body: { items: [withCv, withoutCv], limit: 20, offset: 0 },
  }));
  await mockUserFile(page, { body: mockedPdfBytes });

  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();

  const cards = page.getByTestId('history-item');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByTestId('history-cv-download')).toHaveText(
    'Baixar CV',
  );
  await expect(cards.nth(0).getByTestId('history-pdf-download')).toBeVisible();
  await expect(cards.nth(0).getByTestId('cover-letter-generate')).toBeEnabled();
  await expect(cards.nth(1).getByTestId('history-cv-download')).toHaveCount(0);
  await expect(cards.nth(1).getByTestId('history-pdf-download')).toHaveCount(0);
  await expect(cards.nth(1).locator('a')).toHaveCount(0);
  expect(fileGets).toHaveLength(0);

  await cards.nth(0).getByTestId('history-cv-download').click();
  await expect(cards.nth(0).getByTestId('history-cv-download-success')).toHaveText(
    'CV baixado.',
  );
  expect(fileGets).toHaveLength(1);
  expect(fileGets[0].url).toContain('/users/me/files/cv-acme.pdf');
  expect(fileGets[0].authorization).toBe('Bearer jwt-login');
  expect(fileGets[0].userId).toBeUndefined();
  expect(fileGets[0].url).not.toContain('token=');
  expect(fileGets[0].url).not.toContain('jwt-login');
  await expect(page.getByTestId('history-list')).toBeVisible();
  await expect(cards.nth(0).getByTestId('cover-letter-generate')).toBeEnabled();
});

test('erro ao baixar o CV fica generico e a carta continua disponivel', async ({
  page,
}) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    body: { items: [withCv], limit: 20, offset: 0 },
  }));
  await mockCoverLetter(page, () => ({
    body: {
      texto_resposta: 'Ola, Acme.',
      pdf_url: '/users/me/files/carta-acme.pdf',
      user_id: 'user-1',
    },
  }));
  await page.route('**/users/me/files/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        detail:
          'GET /users/me/files/cv-acme.pdf Bearer jwt-login https://meu-agente-de-emprego.onrender.com',
      }),
    });
  });

  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();
  await page.getByTestId('history-cv-download').click();

  const error = page.getByTestId('history-cv-download-error');
  await expect(error).toHaveText(
    'Nao foi possivel baixar o CV desta analise. Tente novamente.',
  );
  await expect(error).not.toContainText('/users/me');
  await expect(error).not.toContainText('jwt-login');
  await expect(error).not.toContainText('onrender.com');
  await expect(page.getByTestId('history-list')).toBeVisible();

  await page.getByTestId('cover-letter-generate').click();
  await expect(page.getByTestId('cover-letter-text')).toHaveText('Ola, Acme.');
});
