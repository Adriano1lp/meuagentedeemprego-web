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

test('C1 exportar meus dados baixa o JSON sem password nem hash', async ({ page }) => {
  const exportHits: { authorization?: string; method: string }[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/users/me/export')) {
      exportHits.push({
        authorization: request.headers().authorization,
        method: request.method(),
      });
    }
  });

  const secretHash = 'hash-secreto-nao-mostrar';
  await mockDataExport(page, {
    ...mockedExport,
    password: 'senha-plana',
    password_hash: secretHash,
    user: {
      ...(mockedExport.user as Record<string, unknown>),
      hash: 'outro-hash',
      checksum_sha256: 'keep-me',
    },
  });
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
  const downloaded = JSON.parse(await readFile(saved!, 'utf8')) as Record<
    string,
    unknown
  >;
  expect(downloaded).not.toHaveProperty('password');
  expect(downloaded).not.toHaveProperty('password_hash');
  expect(downloaded.user).toMatchObject({
    email: 'ada@example.com',
    checksum_sha256: 'keep-me',
  });
  expect(downloaded.user).not.toHaveProperty('hash');
  await expect(page.getByTestId('lgpd-account-section')).not.toContainText(secretHash);
  await expect(page.getByTestId('lgpd-account-section')).not.toContainText('senha-plana');
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

test('C2 erro de exportacao oferece retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/users/me/export', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'File "/app/main.py" GET /users/me/export Bearer jwt-abc',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockedExport),
    });
  });

  await openProfile(page);
  await page.getByTestId('export-data').click();
  const error = page.getByTestId('export-data-error');
  await expect(error).toBeVisible();
  await expect(error).not.toContainText('/users/me');
  await expect(error).not.toContainText('jwt-abc');
  await expect(error).not.toContainText('main.py');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-data-retry').click();
  const download = await downloadPromise;
  await expect(page.getByTestId('export-data-success')).toBeVisible();
  expect(download.suggestedFilename()).toBe('meus-dados.json');
  expect(attempts).toBe(2);
});

test('C3 cancelar ou confirm diferente de DELETE nao chama a API', async ({ page }) => {
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
  await page.getByTestId('delete-account-confirm').click();
  await expect(page.getByTestId('delete-account-mismatch')).toBeVisible();
  await page.getByTestId('delete-account-confirm-input').fill('delete');
  await page.getByTestId('delete-account-confirm').click();
  await expect(page.getByTestId('delete-account-mismatch')).toBeVisible();
  expect(deleteHits).toEqual([]);
  await page.getByTestId('delete-account-cancel').click();

  await expect(page.getByTestId('delete-account-dialog')).toHaveCount(0);
  await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  expect(deleteHits).toEqual([]);
  await expect(page).toHaveURL(/\/perfil$/);
});

test('C4 confirmar DELETE encerra a sessao', async ({ page }) => {
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
  await page.getByTestId('delete-account-confirm-input').fill('DELETE');
  await page.getByTestId('delete-account-confirm').click();

  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page.getByTestId('account-deleted-notice')).toHaveText(
    'Sua conta foi excluida.',
  );
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

test('C5 sem JWT redireciona ao login e nao chama export nem delete', async ({ page }) => {
  const lgpdHits: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/users/me/export') || path.endsWith('/users/me')) {
      lgpdHits.push(`${request.method()} ${path}`);
    }
  });

  await mockLegalRoutes(page);
  await page.goto('/perfil');
  await expect(page).toHaveURL(/http:\/\/127\.0\.0\.1:5173\/?$/);
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page.getByTestId('lgpd-account-section')).toHaveCount(0);
  await expect(page.getByTestId('export-data')).toHaveCount(0);
  expect(lgpdHits).toEqual([]);
});

test('401 na exportacao volta ao login', async ({ page }) => {
  await page.route('**/users/me/export', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Usuario nao encontrado' }),
    });
  });
  await openProfile(page);
  await page.getByTestId('export-data').click();
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page.getByTestId('account-deleted-notice')).toHaveCount(0);
  await expect(page).toHaveURL(/http:\/\/127\.0\.0\.1:5173\/?$/);
});

test('403 OUTDATED na exportacao abre o reaceite', async ({ page }) => {
  await page.route('**/users/me/export', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: {
          code: 'TERMS_OUTDATED',
          message: 'Termos de uso desatualizados. Reaceite a versao vigente.',
        },
      }),
    });
  });
  await openProfile(page);
  await page.getByTestId('export-data').click();
  await expect(page.getByTestId('consent-gate')).toBeVisible();
  await expect(page.getByTestId('consent-gate')).toContainText(
    'Documentos legais atualizados',
  );
  await expect(page.getByTestId('export-data-error')).toHaveCount(0);
  await expect(page).toHaveURL(/\/perfil$/);
});
