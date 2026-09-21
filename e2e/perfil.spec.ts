import { expect, test } from '@playwright/test';

import {
  mockAuthSuccess,
  mockCurrentUser,
  mockLegalRoutes,
  mockOutdatedMe,
  mockedCurrentUser,
} from './helpers';

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('render dos dados mockados — nome, email, plano e status', async ({ page }) => {
  const profileUrls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/users\/me$/.test(new URL(url).pathname)) {
      profileUrls.push(url);
      expect(request.headers().authorization).toBe('Bearer jwt-login');
      expect(request.headers()['x-user-id']).toBeUndefined();
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page, mockedCurrentUser);
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-perfil').click();

  await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(page.getByTestId('profile-email')).toHaveText('ada@example.com');
  await expect(page.getByTestId('profile-plan')).toHaveText('Essencial');
  await expect(page.getByTestId('profile-status')).toHaveText('Ativa');
  await expect(page.getByText('99')).toHaveCount(0);
  expect(profileUrls.length).toBeGreaterThan(0);

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
    token:
      localStorage.getItem('access_token') ??
      sessionStorage.getItem('access_token'),
  }));
  expect(storage).toEqual({ local: 0, session: 0, token: null });
});

test('logout limpa a sessao e volta ao login', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-perfil').click();
  await expect(page.getByTestId('profile-logout')).toBeVisible();

  await page.getByTestId('profile-logout').click();
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page).toHaveURL(/http:\/\/127\.0\.0\.1:5173\/?$/);
  await expect(page.getByTestId('profile-panel')).toHaveCount(0);
  await expect(page.getByTestId('profile-name')).toHaveCount(0);

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  expect(storage).toEqual({ local: 0, session: 0 });
});

test('sem JWT redireciona ao login e nao chama GET /users/me', async ({ page }) => {
  const profileHits: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/users/me')) {
      profileHits.push(request.url());
    }
    const auth = request.headers().authorization;
    if (auth) {
      expect(auth).not.toBe('Bearer');
      expect(auth).not.toBe('Bearer ');
      expect(auth).not.toContain('undefined');
    }
  });

  await mockLegalRoutes(page);
  await page.goto('/perfil');
  await expect(page).toHaveURL(/http:\/\/127\.0\.0\.1:5173\/?$/);
  await expect(page).not.toHaveURL(/perfil/);
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page.getByTestId('profile-panel')).toHaveCount(0);
  expect(profileHits).toEqual([]);

  await mockOutdatedMe(page);
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('consent-gate')).toBeVisible();
  expect(profileHits).toEqual([]);
});

test('atalho LGPD abre a politica de privacidade ja existente', async ({ page }) => {
  const privacyHits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/legal/privacy')) {
      privacyHits.push(request.url());
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-perfil').click();
  await expect(page.getByTestId('profile-privacy-link')).toBeVisible();
  expect(privacyHits).toEqual([]);

  await page.getByTestId('profile-privacy-link').click();
  await expect(page.getByTestId('profile-privacy-text')).toContainText(
    'Texto vigente de Politica de privacidade v1.0',
  );
  await expect(page.getByTestId('privacyAcceptCheckbox')).toHaveCount(0);
  expect(privacyHits.some((url) => url.includes('/legal/privacy'))).toBe(true);
});
