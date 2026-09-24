import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import {
  mockAuthSuccess,
  mockCurrentUser,
  mockDataExport,
  mockDeleteAccount,
  mockLegalRoutes,
  mockedExport,
} from './helpers';

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

async function openProfile(page: import('@playwright/test').Page) {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-perfil').click();
  await expect(page.getByTestId('lgpd-account-section')).toBeVisible();
}

test('exportar meus dados baixa o JSON da API', async ({ page }) => {
  const exportHits: { authorization?: string; method: string }[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/users/me/export')) {
      exportHits.push({
        authorization: request.headers().authorization,
        method: request.method(),
      });
    }
  });

  await mockDataExport(page);
  await openProfile(page);
  expect(exportHits).toEqual([]);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-data').click();
  const download = await downloadPromise;

  await expect(page.getByTestId('export-data-success')).toHaveText(
    'Seus dados foram baixados.',
  );
  expect(download.suggestedFilename()).toBe('meus-dados.json');
  const saved = await download.path();
  expect(saved).toBeTruthy();
  expect(JSON.parse(await readFile(saved!, 'utf8'))).toEqual(mockedExport);
  expect(exportHits).toEqual([
    { authorization: 'Bearer jwt-login', method: 'GET' },
  ]);

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
    token:
      localStorage.getItem('access_token') ??
      sessionStorage.getItem('access_token'),
  }));
  expect(storage).toEqual({ local: 0, session: 0, token: null });
});

test('cancelar a exclusao nao chama DELETE', async ({ page }) => {
  const deleteHits: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/users/me') && request.method() === 'DELETE') {
      deleteHits.push(request.url());
    }
  });

  await mockDeleteAccount(page);
  await openProfile(page);
  await page.getByTestId('delete-account-open').click();
  await expect(page.getByTestId('delete-account-dialog')).toBeVisible();
  await page.getByTestId('delete-account-cancel').click();

  await expect(page.getByTestId('delete-account-dialog')).toHaveCount(0);
  await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  expect(deleteHits).toEqual([]);
  await expect(page).toHaveURL(/\/perfil$/);
});

test('confirmar exclusao encerra a sessao', async ({ page }) => {
  const deleteHits: { authorization?: string; body: string | null }[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/users/me') && request.method() === 'DELETE') {
      deleteHits.push({
        authorization: request.headers().authorization,
        body: request.postData(),
      });
    }
  });

  await mockDeleteAccount(page);
  await openProfile(page);
  await page.getByTestId('delete-account-open').click();
  await page.getByTestId('delete-account-confirm').click();

  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page).toHaveURL(/http:\/\/127\.0\.0\.1:5173\/?$/);
  await expect(page.getByTestId('profile-panel')).toHaveCount(0);
  await expect(page.getByTestId('delete-account-dialog')).toHaveCount(0);
  expect(deleteHits).toEqual([
    {
      authorization: 'Bearer jwt-login',
      body: JSON.stringify({ confirm: 'DELETE' }),
    },
  ]);

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  expect(storage).toEqual({ local: 0, session: 0 });
});
