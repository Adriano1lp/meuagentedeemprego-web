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
    lease: localStorage.getItem('mae.sessionLease'),
  }));
  expect(storage.session).toBe(0);
  expect(storage.local).toBe(1);
  expect(storage.lease).not.toMatch(/jwt|eyJ|access_token/i);
  const lease = JSON.parse(storage.lease ?? '') as { phase?: string };
  expect(lease.phase).toBe('done');

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
  const stuck = await page.evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
  expect(stuck).not.toMatch(/jwt|eyJ|access_token/i);
  // sending não é retomado. O login apaga a chave; aqui o teste só troca o mock.
  await page.evaluate(() => localStorage.removeItem('mae.sessionLease'));

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

test('logout offline, reload sem refresh e online reenvia o logout', async ({
  page,
  context,
}, testInfo) => {
  let refreshPosts = 0;
  let logoutPosts = 0;
  const csrf: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') {
      return;
    }
    if (request.url().includes('/auth/refresh')) {
      refreshPosts += 1;
    }
    if (request.url().includes('/auth/logout')) {
      logoutPosts += 1;
      csrf.push(request.headers()['x-mae-csrf'] ?? '');
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await page.goto('/entrar');
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('logout-button')).toBeVisible();
  const refreshAfterLogin = refreshPosts;

  await context.setOffline(true);
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const logoutAtExit = logoutPosts;
  const stored = await page.evaluate(() => ({
    flag: localStorage.getItem('mae.loggedOut'),
    length: localStorage.length,
    token: localStorage.getItem('access_token'),
  }));
  expect(stored).toEqual({ flag: '1', length: 1, token: null });

  await context.setOffline(false);
  await expect.poll(() => logoutPosts).toBeGreaterThan(logoutAtExit);
  expect(csrf.length).toBeGreaterThan(0);
  expect(csrf.every((value) => value === '1')).toBe(true);

  await page.goto('/app/perfil');
  await expect(page).toHaveURL(/\/entrar/);
  expect(new URL(page.url()).pathname).toBe('/entrar');
  expect(refreshPosts).toBe(refreshAfterLogin);
  const afterReload = await page.evaluate(() => localStorage.getItem('mae.loggedOut'));
  expect(afterReload).toBe('1');
  await page.screenshot({
    path: testInfo.outputPath('logout-offline-entrar.png'),
    fullPage: true,
  });

  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(page).toHaveURL(/\/app\/perfil$/);
  expect(await page.evaluate(() => localStorage.getItem('mae.loggedOut'))).toBeNull();
});

test('duas abas com a flag reenviam um único logout e não dão refresh', async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('mae.loggedOut', '1');
  });
  let logoutPosts = 0;
  let refreshPosts = 0;
  await context.route('**/auth/logout', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    logoutPosts += 1;
    expect(route.request().headers()['x-mae-csrf']).toBe('1');
    if (logoutPosts === 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await route.fulfill({ status: 204, body: '' });
  });
  context.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/auth/refresh')) {
      refreshPosts += 1;
    }
  });

  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await Promise.all([pageA.goto('/entrar'), pageB.goto('/entrar')]);
  await expect.poll(() => logoutPosts).toBe(1);
  expect(refreshPosts).toBe(0);
  expect(await pageA.evaluate(() => localStorage.getItem('mae.loggedOut'))).toBe('1');
  expect(await pageB.evaluate(() => localStorage.getItem('mae.loggedOut'))).toBe('1');
  const dump = await pageA.evaluate(() => localStorage.getItem('mae.loggedOut'));
  expect(dump).toBe('1');
  expect(dump).not.toMatch(/jwt|eyJ|token/i);
});

test('storage bloqueado ainda envia o logout e o F5 em /app cai em /entrar', async ({ page }) => {
  await page.addInitScript(() => {
    const deny = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
      Object.defineProperty(window.localStorage, name, {
        configurable: true,
        value: deny,
      });
    }
  });

  let loggedOut = false;
  let logoutPosts = 0;
  let refreshAfterLogout = 0;
  await page.route('**/auth/refresh', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    if (loggedOut) {
      refreshAfterLogout += 1;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Sessao invalida' }),
      });
      return;
    }
    await fulfillRefresh(route);
  });
  await page.route('**/auth/logout', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    logoutPosts += 1;
    loggedOut = true;
    expect(route.request().headers()['x-mae-csrf']).toBe('1');
    await route.fulfill({ status: 204, body: '' });
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await page.goto('/app');
  await expect(page.getByTestId('logout-button')).toBeVisible();
  expect(
    await page.evaluate(() => {
      try {
        localStorage.setItem('mae.loggedOut', '1');
        return 'open';
      } catch (error) {
        return error instanceof DOMException ? error.name : 'other';
      }
    }),
  ).toBe('SecurityError');

  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('landing-page')).toBeVisible();
  expect(logoutPosts).toBe(1);

  await page.goto('/app');
  await expect(page).toHaveURL(/\/entrar/);
  expect(new URL(page.url()).pathname).toBe('/entrar');
  await expect(page.getByTestId('home-shell')).toHaveCount(0);
  expect(refreshAfterLogout).toBeGreaterThan(0);
});

test('falha de refresh no boot da aba nova não derruba a aba logada', async ({ context }, testInfo) => {
  let failBoot = false;
  await context.route('**/auth/refresh', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    if (failBoot) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Sessao invalida' }),
      });
      return;
    }
    await fulfillRefresh(route);
  });

  const pageA = await context.newPage();
  await mockLegalRoutes(pageA);
  await mockAuthSuccess(pageA);
  await mockCurrentUser(pageA);
  await pageA.goto('/app/perfil');
  await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(pageA).toHaveURL(/\/app\/perfil$/);

  failBoot = true;
  await pageA.evaluate(() => localStorage.removeItem('mae.sessionLease'));
  const pageB = await context.newPage();
  await mockLegalRoutes(pageB);
  await mockAuthSuccess(pageB);
  await mockCurrentUser(pageB);
  await pageB.goto('/app/perfil');
  await expect(pageB.getByTestId('session-expired-notice')).toHaveText(
    'Sua sessão expirou. Entre de novo.',
  );
  const expired = new URL(pageB.url());
  expect(expired.pathname).toBe('/entrar');
  expect(expired.searchParams.get('aviso')).toBe('sessao');
  expect(expired.searchParams.get('next')).toBe('/app/perfil');

  await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(pageA).toHaveURL(/\/app\/perfil$/);
  await expect(pageA.getByTestId('session-expired-notice')).toHaveCount(0);
  await expect(pageA.getByTestId('login-submit')).toHaveCount(0);

  await pageA.screenshot({
    path: testInfo.outputPath('aba-logada.png'),
    fullPage: true,
  });
  await pageB.screenshot({
    path: testInfo.outputPath('aba-boot-entrar.png'),
    fullPage: true,
  });
});

test('reenvio do logout espera entre tentativas e não entra em loop', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('mae.loggedOut', '1');
  });
  let logoutPosts = 0;
  await page.route('**/auth/logout', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    logoutPosts += 1;
    await route.fulfill({ status: 500, body: '' });
  });

  await page.goto('/entrar');
  await expect.poll(() => logoutPosts).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(400);
  expect(logoutPosts).toBe(1);
  await expect.poll(() => logoutPosts, { timeout: 3_000 }).toBe(2);
  await page.waitForTimeout(2_500);
  expect(logoutPosts).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('mae.loggedOut'))).toBe('1');

  await page.screenshot({
    path: testInfo.outputPath('logout-backoff.png'),
    fullPage: true,
  });
});
