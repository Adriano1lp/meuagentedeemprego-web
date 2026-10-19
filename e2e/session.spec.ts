import {
  mockAuthSuccess,
  mockCurrentUser,
  mockLegalRoutes,
  mockedStatus,
  mockUserStatus,
} from './helpers';
import { expect, test } from './fixtures';

const grant = {
  access_token: 'jwt-refresh',
  token_type: 'bearer',
  expires_in: 3600,
};

async function fulfillRefresh(route: import('@playwright/test').Route): Promise<void> {
  const headers = route.request().headers();
  expect(headers['x-mae-csrf']).toBe('1');
  expect(headers.authorization ?? '').not.toContain('jwt');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(grant),
  });
}

test('reload em /app/perfil fica na mesma rota, sem passar por /entrar', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    const note = () => {
      for (const id of ['landing-page', 'auth-tab-login', 'session-boot', 'profile-name']) {
        if (document.querySelector(`[data-testid="${id}"]`)) {
          seen.push(id);
        }
      }
    };
    const start = () => {
      note();
      new MutationObserver(note).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start);
    }
    (window as unknown as { __maePaint: string[] }).__maePaint = seen;
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await page.route('**/auth/refresh', async (route) => {
    await fulfillRefresh(route);
  });

  await page.goto('/app/perfil');
  await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(page).toHaveURL(/\/app\/perfil$/);
  await expect(page.getByTestId('landing-page')).toHaveCount(0);
  await expect(page.getByTestId('auth-tab-login')).toHaveCount(0);

  const paint = await page.evaluate(
    () => (window as unknown as { __maePaint: string[] }).__maePaint,
  );
  expect(paint).toContain('session-boot');
  expect(paint).not.toContain('landing-page');
  expect(paint).not.toContain('auth-tab-login');

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  expect(storage).toEqual({ local: 0, session: 0 });

  await page.screenshot({
    path: testInfo.outputPath('reload-perfil.png'),
    fullPage: true,
  });
});

test('deep link /app/curriculo com cookie permanece; sem cookie vai para /entrar?next', async ({
  page,
}, testInfo) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, { ...mockedStatus, has_cv: true, has_embeddings: true });

  await page.goto('/app/curriculo');
  await expect(page.getByTestId('session-expired-notice')).toHaveText(
    'Sua sessão expirou. Entre de novo.',
  );
  const expired = new URL(page.url());
  expect(expired.pathname).toBe('/entrar');
  expect(expired.searchParams.get('aviso')).toBe('sessao');
  expect(expired.searchParams.get('next')).toBe('/app/curriculo');
  await expect(page.getByTestId('curriculo-page')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('refresh-401-next.png'),
    fullPage: true,
  });

  await page.route('**/auth/refresh', async (route) => {
    await fulfillRefresh(route);
  });
  await page.goto('/app/curriculo');
  await expect(page.getByTestId('curriculo-page')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/curriculo$/);
  await expect(page.getByTestId('session-expired-notice')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('deep-link-curriculo.png'),
    fullPage: true,
  });
});

test('duas abas com access ausente fazem um unico POST /auth/refresh', async ({ context }, testInfo) => {
  let refreshPosts = 0;
  await context.route('**/auth/refresh', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    refreshPosts += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await fulfillRefresh(route);
  });

  const pageA = await context.newPage();
  const pageB = await context.newPage();
  for (const tab of [pageA, pageB]) {
    await mockLegalRoutes(tab);
    await mockAuthSuccess(tab);
    await mockCurrentUser(tab);
  }

  await Promise.all([pageA.goto('/app/perfil'), pageB.goto('/app/perfil')]);
  await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(pageB.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(pageA).toHaveURL(/\/app\/perfil$/);
  await expect(pageB).toHaveURL(/\/app\/perfil$/);
  expect(refreshPosts).toBe(1);

  await pageA.screenshot({
    path: testInfo.outputPath('duas-abas-a.png'),
    fullPage: true,
  });
  await pageB.screenshot({
    path: testInfo.outputPath('duas-abas-b.png'),
    fullPage: true,
  });

  let logoutPosts = 0;
  const countLogout = (url: string, method: string) => {
    if (method === 'POST' && url.includes('/auth/logout')) {
      logoutPosts += 1;
    }
  };
  pageA.on('request', (request) => countLogout(request.url(), request.method()));
  pageB.on('request', (request) => countLogout(request.url(), request.method()));

  await pageA.getByTestId('logout-button').click();
  await expect(pageA.getByTestId('landing-page')).toBeVisible();
  await expect(pageA).toHaveURL(/\/$/);
  await expect(pageB.getByTestId('landing-page')).toBeVisible();
  await expect(pageB).toHaveURL(/\/$/);
  await expect(pageB.getByTestId('profile-name')).toHaveCount(0);
  expect(logoutPosts).toBe(1);

  await pageB.screenshot({
    path: testInfo.outputPath('logout-outra-aba.png'),
    fullPage: true,
  });
});
