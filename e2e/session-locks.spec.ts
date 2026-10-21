import { expectExpiredLogin, mockAuthSuccess, mockCurrentUser, mockLegalRoutes } from './helpers';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from './fixtures';

const GRANT = {
  access_token: 'jwt-refresh',
  token_type: 'bearer',
  expires_in: 3600,
};

const ORIGIN = 'http://127.0.0.1:5173';

type Counter = { posts: number };

type Row = {
  scenario: string;
  posts: number;
  ok: boolean;
  error?: string;
};

function track(context: BrowserContext, counter: Counter): void {
  context.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/auth/refresh')) {
      counter.posts += 1;
    }
  });
}

async function hideLocks(context: BrowserContext): Promise<void> {
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

async function hideChannel(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const broken = function BroadcastChannel() {
      throw new Error('sem canal');
    };
    try {
      Object.defineProperty(window, 'BroadcastChannel', {
        configurable: true,
        value: broken,
      });
    } catch {
      (window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = broken;
    }
  });
}

async function holdFirstJitter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    let armed = true;
    const wrapped: typeof window.setTimeout = (handler, timeout, ...args) => {
      const delay = typeof timeout === 'number' ? timeout : 0;
      if (armed && args.length === 0 && delay >= 30 && delay <= 80) {
        let phase = '';
        try {
          const raw = localStorage.getItem('mae.sessionLease');
          phase = raw ? ((JSON.parse(raw) as { phase?: string }).phase ?? '') : '';
        } catch {
          phase = '';
        }
        if (phase === 'open') {
          armed = false;
          (window as unknown as { __maeJitterHeld?: boolean }).__maeJitterHeld = true;
          return original(handler, 120_000);
        }
      }
      return original(handler, timeout as number, ...args);
    };
    window.setTimeout = wrapped;
  });
}

async function openContext(browser: Browser, withLocks: boolean, counter: Counter): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    baseURL: ORIGIN,
    serviceWorkers: 'block',
  });
  if (!withLocks) {
    await hideLocks(context);
  }
  track(context, counter);
  await context.addCookies([
    {
      name: 'mae_refresh',
      value: 'lease-e2e',
      url: ORIGIN,
    },
  ]);
  return context;
}

async function prepare(page: Page): Promise<void> {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
}

async function fulfillOk(route: import('@playwright/test').Route, token = 'jwt-refresh'): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...GRANT, access_token: token }),
  });
}

async function fulfillDenied(route: import('@playwright/test').Route): Promise<void> {
  await route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Sessao invalida' }),
  });
}

async function leasePhase(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const raw = localStorage.getItem('mae.sessionLease');
      if (!raw) {
        return 'ausente';
      }
      try {
        const parsed = JSON.parse(raw) as { phase?: string };
        return parsed.phase ?? 'sem-fase';
      } catch {
        return 'ruim';
      }
    });
  } catch {
    return 'navegando';
  }
}

async function scenario(
  rows: Row[],
  name: string,
  body: (counter: Counter) => Promise<void>,
): Promise<void> {
  const counter: Counter = { posts: 0 };
  let error = '';
  try {
    await body(counter);
    rows.push({ scenario: name, posts: counter.posts, ok: true });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    rows.push({
      scenario: name,
      posts: counter.posts,
      ok: false,
      error: error.slice(0, 500),
    });
    throw caught;
  }
}

async function publish(testInfo: TestInfo, rows: Row[], withLocks: boolean): Promise<void> {
  const payload = {
    repeat: testInfo.repeatEachIndex,
    project: testInfo.project.name,
    title: testInfo.title,
    locks: withLocks,
    scenarios: rows,
    posts: rows.reduce((sum, row) => sum + row.posts, 0),
  };
  console.log(`REFRESH_POSTS ${JSON.stringify(payload)}`);
  await testInfo.attach('refresh-posts.json', {
    body: JSON.stringify(payload, null, 2),
    contentType: 'application/json',
  });
}

async function orphan(browser: Browser, withLocks: boolean, counter: Counter): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    await context.addInitScript(() => {
      localStorage.setItem(
        'mae.sessionLease',
        JSON.stringify({
          leaseId: '11111111-1111-4111-8111-111111111111',
          epoch: 2,
          owner: 'aba-orfa',
          until: Date.now() + 800,
          phase: 'open',
        }),
      );
    });
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await fulfillOk(route);
    });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/app/perfil');
    await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
    expect(await page.evaluate(() => navigator.locks != null)).toBe(withLocks);
    expect(counter.posts).toBe(1);
    const raw = await page.evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt|eyJ|access_token/i);
    expect((JSON.parse(raw) as { phase: string }).phase).toBe('done');
  } finally {
    await context.close();
  }
}

async function leaderDeadBeforeSend(browser: Browser, withLocks: boolean, counter: Counter): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await fulfillOk(route);
    });
    const leader = await context.newPage();
    await holdFirstJitter(leader);
    await prepare(leader);
    const navLeader = leader.goto('/app/perfil');
    await expect.poll(() => leasePhase(leader), { timeout: 10_000 }).toBe('open');
    expect(counter.posts).toBe(0);
    expect(await leader.evaluate(() => (window as unknown as { __maeJitterHeld?: boolean }).__maeJitterHeld === true)).toBe(
      true,
    );
    const survivor = await context.newPage();
    await prepare(survivor);
    const navSurvivor = survivor.goto('/app/perfil');
    await leader.close();
    await navLeader.catch(() => undefined);
    await expect(survivor.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
    await navSurvivor;
    expect(counter.posts).toBe(1);
    const raw = await survivor.evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt|eyJ|access_token/i);
  } finally {
    await context.close();
  }
}

async function ownerDeadAfterFetch(browser: Browser, withLocks: boolean, counter: Counter): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  let release = () => {};
  let abortInFlight: (() => Promise<void>) | null = null;
  try {
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await new Promise<void>((resolve) => {
        release = resolve;
        abortInFlight = async () => {
          try {
            await route.abort();
          } catch {
            // O fechamento da aba já derrubou o POST.
          }
          resolve();
        };
      });
    });
    const owner = await context.newPage();
    await prepare(owner);
    const navOwner = owner.goto('/app/perfil');
    await expect.poll(() => counter.posts, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => leasePhase(owner), { timeout: 5_000 }).toBe('sending');
    const survivor = await context.newPage();
    await prepare(survivor);
    const navSurvivor = survivor.goto('/app/perfil');
    await survivor.waitForTimeout(250);
    await abortInFlight?.();
    await owner.close({ runBeforeUnload: true });
    await navOwner.catch(() => undefined);
    release();
    await expect(survivor).toHaveURL(/\/entrar\?/, { timeout: 15_000 });
    expectExpiredLogin(survivor, '/app/perfil');
    await navSurvivor.catch(() => undefined);
    expect(counter.posts).toBe(1);
    const raw = await survivor.evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt|eyJ|access_token/i);
  } finally {
    release();
    await context.close();
  }
}

/** Primeiro carregamento simultâneo. Não recarrega a página. */
async function f5(browser: Browser, withLocks: boolean, counter: Counter, tabCount: number): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (withLocks && seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await fulfillOk(route);
    });
    const pages: Page[] = [];
    for (let index = 0; index < tabCount; index += 1) {
      const page = await context.newPage();
      await prepare(page);
      pages.push(page);
    }
    await Promise.all(pages.map((page) => page.goto('/app/perfil')));
    for (const page of pages) {
      await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
      await expect(page).toHaveURL(/\/app\/perfil$/);
    }
    if (withLocks) {
      expect(counter.posts).toBe(1);
    } else {
      expect(counter.posts).toBeGreaterThanOrEqual(1);
    }
    const raw = await pages[0].evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt|eyJ|access_token/i);
    expect((JSON.parse(raw) as { phase: string }).phase).toBe('done');
  } finally {
    await context.close();
  }
}

async function slowPost(browser: Browser, withLocks: boolean, counter: Counter): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (withLocks && seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      await fulfillOk(route, 'jwt-lento');
    });
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await prepare(pageA);
    await prepare(pageB);
    await Promise.all([pageA.goto('/app/perfil'), pageB.goto('/app/perfil')]);
    await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
    await expect(pageB.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
    if (withLocks) {
      expect(counter.posts).toBe(1);
    } else {
      expect(counter.posts).toBeGreaterThanOrEqual(1);
    }
    const raw = await pageA.evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt|eyJ|access_token/i);
    expect((JSON.parse(raw) as { phase: string }).phase).toBe('done');
  } finally {
    await context.close();
  }
}

async function logoutDuringSlowPost(browser: Browser, withLocks: boolean, counter: Counter): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    let slow = false;
    const authz: string[] = [];
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      if (!slow) {
        await fulfillOk(route, 'jwt-refresh');
        return;
      }
      await held;
      try {
        await fulfillOk(route, 'jwt-velho');
      } catch {
        // A navegação da aba já seguiu.
      }
    });
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await prepare(pageA);
    await prepare(pageB);
    const spy = async (page: Page) => {
      await page.route('**/auth/me', async (route) => {
        authz.push(route.request().headers()['authorization'] ?? '');
        await route.fallback();
      });
    };
    await spy(pageA);
    await spy(pageB);
    await Promise.all([pageA.goto('/app/perfil'), pageB.goto('/app/perfil')]);
    await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace');
    await expect(pageB.getByTestId('profile-name')).toHaveText('Ada Lovelace');
    expect(counter.posts).toBe(1);

    await pageB.evaluate(() => localStorage.removeItem('mae.sessionLease'));
    slow = true;
    const reloaded = pageA.reload();
    await expect.poll(() => counter.posts, { timeout: 10_000 }).toBe(2);
    const started = Date.now();
    await pageB.getByTestId('logout-button').click();
    await expect(pageB.getByTestId('landing-page')).toBeVisible();
    await pageB.goto('/entrar');
    await pageB.getByTestId('login-email').fill('ada@example.com');
    await pageB.getByTestId('login-password').fill('senha-segura');
    await pageB.getByTestId('login-submit').click();
    await expect(pageB.getByTestId('logout-button')).toBeVisible({ timeout: 10_000 });
    const marked = authz.length;
    const elapsed = Date.now() - started;
    if (elapsed < 5_500) {
      await pageB.waitForTimeout(5_500 - elapsed);
    }
    release();
    await reloaded.catch(() => undefined);
    await pageA.waitForTimeout(400);
    const stored = await pageB.evaluate(() => ({
      lease: localStorage.getItem('mae.sessionLease'),
      dump: JSON.stringify(localStorage),
    }));
    expect(stored.lease).toBeNull();
    expect(stored.dump).not.toMatch(/jwt-velho|jwt-refresh|jwt-login/);
    expect(authz.slice(marked).some((value) => value.includes('jwt-velho'))).toBe(false);
    await expect(pageB.getByTestId('logout-button')).toBeVisible();
    await expect(pageA.getByTestId('profile-name')).toHaveCount(0);
    expect(counter.posts).toBe(2);
  } finally {
    release();
    await context.close();
  }
}

async function wrongGrant(browser: Browser, withLocks: boolean, counter: Counter): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    await context.addInitScript(() => {
      localStorage.setItem(
        'mae.sessionLease',
        JSON.stringify({
          leaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          epoch: 4,
          owner: 'aba-alheia',
          until: Date.now() + 4_000,
          phase: 'done',
        }),
      );
      const injector = new BroadcastChannel('mae-web-session');
      const timer = window.setInterval(() => {
        injector.postMessage({
          v: 1,
          type: 'grant',
          leaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          token: 'jwt-errado',
          expiresIn: 3600,
        });
      }, 200);
      window.setTimeout(() => window.clearInterval(timer), 3_600);
    });
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await fulfillOk(route, 'jwt-epoch-novo');
    });
    const page = await context.newPage();
    await prepare(page);
    await page.goto('/app/perfil');
    await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
    expect(counter.posts).toBe(1);
    const raw = await page.evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt-errado|jwt|eyJ|access_token/i);
    expect((JSON.parse(raw) as { phase: string }).phase).toBe('done');
  } finally {
    await context.close();
  }
}

async function tabsWithoutChannel(browser: Browser, withLocks: boolean, counter: Counter): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    await hideChannel(context);
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await fulfillOk(route);
    });
    const pages: Page[] = [];
    for (let index = 0; index < 3; index += 1) {
      const page = await context.newPage();
      await prepare(page);
      pages.push(page);
    }
    expect(await pages[0].evaluate(() => {
      try {
        new BroadcastChannel('mae-web-session');
        return false;
      } catch {
        return true;
      }
    })).toBe(true);
    await Promise.all(pages.map((page) => page.goto('/app/perfil')));
    const settled = async (page: Page): Promise<'app' | 'entrar' | 'espera'> => {
      if (page.url().includes('/entrar')) {
        return 'entrar';
      }
      if ((await page.getByTestId('profile-name').count()) > 0) {
        return 'app';
      }
      return 'espera';
    };
    await expect.poll(async () => {
      const states = await Promise.all(pages.map((page) => settled(page)));
      return states.every((state) => state !== 'espera');
    }, { timeout: 15_000 }).toBe(true);
    let onApp = 0;
    for (const page of pages) {
      const state = await settled(page);
      if (state === 'app') {
        await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
        onApp += 1;
      } else {
        expectExpiredLogin(page, '/app/perfil');
      }
    }
    if (withLocks) {
      expect(onApp).toBe(1);
      expect(counter.posts).toBe(1);
    } else {
      expect(counter.posts).toBeGreaterThanOrEqual(1);
      expect(counter.posts).toBeLessThanOrEqual(pages.length);
      expect(onApp).toBeGreaterThanOrEqual(1);
      if (counter.posts === 1) {
        expect(onApp).toBe(1);
      }
    }
    const raw = await pages[0].evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt|eyJ|access_token/i);
  } finally {
    await context.close();
  }
}

async function blockStorage(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const deny = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const names = ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const;
    const targets = [window.localStorage, Object.getPrototypeOf(window.localStorage)];
    for (const target of targets) {
      for (const name of names) {
        try {
          Object.defineProperty(target, name, {
            configurable: true,
            value: deny,
          });
        } catch {
          // No WebKit o método da instância pode não ser configurável.
        }
      }
    }
  });
}

async function reloadWithinDone(
  browser: Browser,
  withLocks: boolean,
  counter: Counter,
  tabCount: number,
): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (withLocks && seen > 2) {
        await fulfillDenied(route);
        return;
      }
      await fulfillOk(route, seen === 1 ? 'jwt-boot' : `jwt-reload-${seen}`);
    });
    const pages: Page[] = [];
    for (let index = 0; index < tabCount; index += 1) {
      const page = await context.newPage();
      await prepare(page);
      pages.push(page);
    }
    await Promise.all(pages.map((page) => page.goto('/app/perfil')));
    for (const page of pages) {
      await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
    }
    expect(counter.posts).toBe(1);
    const before = await pages[0].evaluate(() => {
      const raw = localStorage.getItem('mae.sessionLease');
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as { phase?: string; until?: number };
      return {
        phase: parsed.phase ?? '',
        remaining: (parsed.until ?? 0) - Date.now(),
      };
    });
    expect(before?.phase).toBe('done');
    expect(before?.remaining ?? 0).toBeGreaterThan(0);
    expect(before?.remaining ?? 99999).toBeLessThanOrEqual(5_000);
    await Promise.all(pages.map((page) => page.reload()));
    for (const page of pages) {
      await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 15_000 });
      await expect(page).toHaveURL(/\/app\/perfil$/);
    }
    if (withLocks || tabCount === 1) {
      expect(counter.posts).toBe(2);
    } else {
      expect(counter.posts).toBeGreaterThanOrEqual(2);
    }
    const raw = await pages[0].evaluate(() => localStorage.getItem('mae.sessionLease') ?? '');
    expect(raw).not.toMatch(/jwt|eyJ|access_token/i);
  } finally {
    await context.close();
  }
}

async function storageBlocked(
  browser: Browser,
  withLocks: boolean,
  counter: Counter,
  tabCount: number,
): Promise<void> {
  const context = await openContext(browser, withLocks, counter);
  try {
    await blockStorage(context);
    let seen = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      seen += 1;
      if (withLocks && seen > 1) {
        await fulfillDenied(route);
        return;
      }
      await fulfillOk(route, 'jwt-degradado');
    });
    const pages: Page[] = [];
    for (let index = 0; index < tabCount; index += 1) {
      const page = await context.newPage();
      await prepare(page);
      pages.push(page);
    }
    await Promise.all(pages.map((page) => page.goto('/app/perfil')));
    expect(
      await pages[0].evaluate(() => {
        try {
          localStorage.setItem('mae.probe', '1');
          return 'open';
        } catch (error) {
          return error instanceof DOMException ? error.name : 'other';
        }
      }),
    ).toBe('SecurityError');
    const settled = async (page: Page): Promise<'app' | 'entrar' | 'espera'> => {
      if (page.url().includes('/entrar')) {
        return 'entrar';
      }
      if ((await page.getByTestId('profile-name').count()) > 0) {
        return 'app';
      }
      return 'espera';
    };
    await expect
      .poll(async () => {
        const states = await Promise.all(pages.map((page) => settled(page)));
        return states.every((state) => state !== 'espera');
      }, { timeout: 15_000 })
      .toBe(true);
    if (withLocks) {
      expect(counter.posts).toBe(1);
      for (const page of pages) {
        await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
        await expect(page).toHaveURL(/\/app\/perfil$/);
      }
      return;
    }
    expect(counter.posts).toBeGreaterThanOrEqual(1);
    expect(counter.posts).toBeLessThanOrEqual(tabCount);
    if (counter.posts === 1) {
      let onApp = 0;
      for (const page of pages) {
        const state = await settled(page);
        if (state === 'app') {
          await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
          onApp += 1;
        } else {
          expectExpiredLogin(page, '/app/perfil');
        }
      }
      expect(onApp).toBe(1);
    }
  } finally {
    await context.close();
  }
}

async function matrix(browser: Browser, withLocks: boolean, rows: Row[]): Promise<void> {
  await scenario(rows, 'marca orfa no boot', (counter) => orphan(browser, withLocks, counter));
  await scenario(rows, 'lider morto antes do envio', (counter) =>
    leaderDeadBeforeSend(browser, withLocks, counter),
  );
  await scenario(rows, 'dono morto apos o fetch', (counter) => ownerDeadAfterFetch(browser, withLocks, counter));
  await scenario(rows, 'F5 2 abas', (counter) => f5(browser, withLocks, counter, 2));
  await scenario(rows, 'F5 3 abas', (counter) => f5(browser, withLocks, counter, 3));
  await scenario(rows, 'F5 4 abas', (counter) => f5(browser, withLocks, counter, 4));
  await scenario(rows, 'reload real 1 aba', (counter) => reloadWithinDone(browser, withLocks, counter, 1));
  await scenario(rows, 'reload real 2 abas', (counter) => reloadWithinDone(browser, withLocks, counter, 2));
  await scenario(rows, 'reload real 3 abas', (counter) => reloadWithinDone(browser, withLocks, counter, 3));
  await scenario(rows, 'storage bloqueado 2 abas', (counter) =>
    storageBlocked(browser, withLocks, counter, 2),
  );
  await scenario(rows, 'storage bloqueado 3 abas', (counter) =>
    storageBlocked(browser, withLocks, counter, 3),
  );
  await scenario(rows, 'POST acima de 5s', (counter) => slowPost(browser, withLocks, counter));
  await scenario(rows, 'logout e login durante POST lento', (counter) =>
    logoutDuringSlowPost(browser, withLocks, counter),
  );
  await scenario(rows, 'grant com leaseId errado', (counter) => wrongGrant(browser, withLocks, counter));
  await scenario(rows, 'abas sem canal', (counter) => tabsWithoutChannel(browser, withLocks, counter));
}

test('com Web Locks, a matriz do lease registra o POST de cada cenário', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const rows: Row[] = [];
  try {
    await matrix(browser, true, rows);
  } finally {
    await publish(testInfo, rows, true);
  }
});

test('sem Web Locks, a matriz do lease registra o POST de cada cenário', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const rows: Row[] = [];
  try {
    await matrix(browser, false, rows);
  } finally {
    await publish(testInfo, rows, false);
  }
});
