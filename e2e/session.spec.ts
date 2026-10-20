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
    mark: localStorage.getItem('mae.sessionRefresh'),
  }));
  expect(storage.session).toBe(0);
  expect(storage.local).toBe(1);
  expect(storage.mark).not.toMatch(/jwt|eyJ|access_token/i);
  expect(storage.mark).toContain('"at"');

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
  await pageA.evaluate(() => localStorage.removeItem('mae.sessionRefresh'));
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

test('duas abas sem locks no F5 simultâneo não revogam a família', async ({ browser }, testInfo) => {
  for (let round = 0; round < 5; round += 1) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const hide = () => undefined;
      try {
        Object.defineProperty(Navigator.prototype, 'locks', {
          configurable: true,
          get: hide,
        });
      } catch {
        Object.defineProperty(navigator, 'locks', {
          configurable: true,
          get: hide,
        });
      }
    });
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: `rodada-${round}`,
        url: 'http://127.0.0.1:5173',
      },
    ]);

    let revoked = false;
    let posts = 0;
    let inflightCookie: string | null = null;
    const used = new Set<string>();
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      const cookie = route.request().headers()['cookie'] ?? '';
      const reuse =
        revoked || used.has(cookie) || (inflightCookie !== null && inflightCookie === cookie);
      if (reuse) {
        revoked = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Sessao invalida' }),
        });
        return;
      }
      posts += 1;
      inflightCookie = cookie;
      await new Promise((resolve) => setTimeout(resolve, 250));
      used.add(cookie);
      inflightCookie = null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie': `mae_refresh=nova-${round}; Path=/; HttpOnly`,
        },
        body: JSON.stringify(grant),
      });
    });

    const pageA = await context.newPage();
    const pageB = await context.newPage();
    for (const tab of [pageA, pageB]) {
      await mockLegalRoutes(tab);
      await mockAuthSuccess(tab);
      await mockCurrentUser(tab);
    }
    expect(await pageA.evaluate(() => navigator.locks == null)).toBe(true);

    await Promise.all([pageA.goto('/app/perfil'), pageB.goto('/app/perfil')]);
    await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace');
    await expect(pageB.getByTestId('profile-name')).toHaveText('Ada Lovelace');
    await expect(pageA).toHaveURL(/\/app\/perfil$/);
    await expect(pageB).toHaveURL(/\/app\/perfil$/);
    expect(revoked, `rodada ${round + 1}`).toBe(false);
    expect(posts, `rodada ${round + 1}`).toBe(1);

    if (round === 0) {
      await pageA.screenshot({
        path: testInfo.outputPath('f5-sem-locks-a.png'),
        fullPage: true,
      });
      await pageB.screenshot({
        path: testInfo.outputPath('f5-sem-locks-b.png'),
        fullPage: true,
      });
    }
    await context.close();
  }
});

async function hideWebLocks(context: import('@playwright/test').BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const hide = () => undefined;
    try {
      Object.defineProperty(Navigator.prototype, 'locks', {
        configurable: true,
        get: hide,
      });
    } catch {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        get: hide,
      });
    }
  });
}

async function pinAttemptId(page: import('@playwright/test').Page, attemptId: string): Promise<void> {
  await page.addInitScript((id) => {
    const value = () => id;
    try {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value });
    } catch {
      crypto.randomUUID = value;
    }
  }, attemptId);
}

async function lateTabDuringSlowPost(
  browser: import('@playwright/test').Browser,
  testInfo: import('@playwright/test').TestInfo,
  delayMs: number,
  round: number,
  capture: boolean,
): Promise<void> {
  const context = await browser.newContext();
  let release = () => {};
  try {
    await hideWebLocks(context);
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: `lento-${delayMs}-${round}`,
        url: 'http://127.0.0.1:5173',
      },
    ]);

    let revoked = false;
    let attempts = 0;
    let inflightCookie: string | null = null;
    const used = new Set<string>();
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      const cookie = route.request().headers()['cookie'] ?? '';
      const reuse =
        revoked || used.has(cookie) || (inflightCookie !== null && inflightCookie === cookie);
      attempts += 1;
      if (reuse || attempts > 1) {
        revoked = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Sessao invalida' }),
        });
        return;
      }
      inflightCookie = cookie;
      await held;
      used.add(cookie);
      inflightCookie = null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie': `mae_refresh=nova-${delayMs}-${round}; Path=/; HttpOnly`,
        },
        body: JSON.stringify(grant),
      });
    });

    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await pinAttemptId(pageA, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    await pinAttemptId(pageB, '00000000-0000-4000-8000-000000000000');
    for (const tab of [pageA, pageB]) {
      await mockLegalRoutes(tab);
      await mockAuthSuccess(tab);
      await mockCurrentUser(tab);
    }
    expect(await pageA.evaluate(() => navigator.locks == null)).toBe(true);

    const navA = pageA.goto('/app/perfil');
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(1);
    await pageA.waitForTimeout(delayMs);
    const navB = pageB.goto('/app/perfil');
    await pageB.waitForTimeout(1_500);
    const label = `atraso ${delayMs}ms rodada ${round + 1}`;
    expect(attempts, label).toBe(1);
    expect(revoked, label).toBe(false);

    release();
    await navA;
    await navB;
    await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace');
    await expect(pageB.getByTestId('profile-name')).toHaveText('Ada Lovelace');
    await expect(pageA).toHaveURL(/\/app\/perfil$/);
    await expect(pageB).toHaveURL(/\/app\/perfil$/);
    expect(attempts, label).toBe(1);
    expect(revoked, label).toBe(false);

    if (capture) {
      await pageA.screenshot({
        path: testInfo.outputPath('post-lento-a.png'),
        fullPage: true,
      });
      await pageB.screenshot({
        path: testInfo.outputPath('post-lento-b.png'),
        fullPage: true,
      });
    }
  } finally {
    release();
    await context.close();
  }
}

test('POST lento com aba tardia de id menor não revoga a família', async ({ browser }, testInfo) => {
  test.setTimeout(360_000);
  for (let round = 0; round < 20; round += 1) {
    await lateTabDuringSlowPost(browser, testInfo, 600, round, round === 0);
  }
});

test('variações de atraso no POST lento não disparam o segundo refresh', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const delays = [100, 450, 900, 1_400];
  for (const delay of delays) {
    for (let round = 0; round < 3; round += 1) {
      await lateTabDuringSlowPost(browser, testInfo, delay, round, false);
    }
  }
});

test('três abas sem locks fazem um único refresh', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext();
  let release = () => {};
  try {
    await hideWebLocks(context);
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: 'tres-abas',
        url: 'http://127.0.0.1:5173',
      },
    ]);

    let revoked = false;
    let attempts = 0;
    let inflightCookie: string | null = null;
    const used = new Set<string>();
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      const cookie = route.request().headers()['cookie'] ?? '';
      const reuse =
        revoked || used.has(cookie) || (inflightCookie !== null && inflightCookie === cookie);
      attempts += 1;
      if (reuse || attempts > 1) {
        revoked = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Sessao invalida' }),
        });
        return;
      }
      inflightCookie = cookie;
      await held;
      used.add(cookie);
      inflightCookie = null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie': 'mae_refresh=nova-tres; Path=/; HttpOnly',
        },
        body: JSON.stringify(grant),
      });
    });

    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const pageC = await context.newPage();
    await pinAttemptId(pageA, 'cccccccc-0000-4000-8000-000000000000');
    await pinAttemptId(pageB, 'aaaaaaaa-0000-4000-8000-000000000000');
    await pinAttemptId(pageC, '00000000-0000-4000-8000-000000000000');
    for (const tab of [pageA, pageB, pageC]) {
      await mockLegalRoutes(tab);
      await mockAuthSuccess(tab);
      await mockCurrentUser(tab);
    }

    const navA = pageA.goto('/app/perfil');
    await pageA.waitForTimeout(100);
    const navB = pageB.goto('/app/perfil');
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(1);
    const navC = pageC.goto('/app/perfil');
    await pageC.waitForTimeout(1_500);
    expect(attempts).toBe(1);
    expect(revoked).toBe(false);

    release();
    await navA;
    await navB;
    await navC;
    for (const tab of [pageA, pageB, pageC]) {
      await expect(tab.getByTestId('profile-name')).toHaveText('Ada Lovelace');
      await expect(tab).toHaveURL(/\/app\/perfil$/);
    }
    expect(attempts).toBe(1);
    expect(revoked).toBe(false);
  } finally {
    release();
    await context.close();
  }
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
