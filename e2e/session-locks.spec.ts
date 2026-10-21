import { expectExpiredLogin, mockAuthSuccess, mockCurrentUser, mockLegalRoutes } from './helpers';
import type { TestInfo } from '@playwright/test';
import { expect, test, type Browser, type Page } from './fixtures';

const grant = {
  access_token: 'jwt-refresh',
  token_type: 'bearer',
  expires_in: 3600,
};

async function prepare(page: Page): Promise<void> {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
}

test('com locks, líder morto em 5 rodadas não gera o segundo POST', async ({ browser }) => {
  test.setTimeout(120_000);
  for (let round = 0; round < 5; round += 1) {
    await deadLeaderRound(browser, round);
  }
});

async function deadLeaderRound(browser: Browser, round: number): Promise<void> {
  const context = await browser.newContext();
  let release = () => {};
  let aborted = false;
  try {
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: `lider-morre-${round}`,
        url: 'http://127.0.0.1:5173',
      },
    ]);

    let revoked = false;
    let attempts = 0;
    let leader: Page | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      attempts += 1;
      if (attempts > 1) {
        revoked = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Sessao invalida' }),
        });
        return;
      }
      leader = route.request().frame()?.page() ?? null;
      await held;
      if (aborted) {
        try {
          await route.abort();
        } catch {
          // A aba já fechou com o POST no ar.
        }
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(grant),
      });
    });

    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await prepare(pageA);
    await prepare(pageB);
    const navA = pageA.goto('/app/perfil');
    const navB = pageB.goto('/app/perfil');
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(1);
    await pageA.waitForTimeout(300);
    expect(leader, `rodada ${round + 1}`).not.toBeNull();
    const survivor = leader === pageA ? pageB : pageA;
    aborted = true;
    await leader!.close({ runBeforeUnload: true });

    await expect(survivor).toHaveURL(/\/entrar\?/, { timeout: 12_000 });
    expectExpiredLogin(survivor, '/app/perfil');
    expect(revoked, `rodada ${round + 1}`).toBe(false);
    expect(attempts, `rodada ${round + 1}`).toBe(1);
    const mark = await survivor.evaluate(() => localStorage.getItem('mae.sessionRefresh'));
    expect(mark ?? '', `rodada ${round + 1}`).not.toMatch(/jwt|eyJ|access_token/i);
    await Promise.allSettled([navA, navB]);
  } finally {
    aborted = true;
    release();
    await context.close();
  }
}

test('com locks, F5 em 2, 3 e 4 abas faz um POST por rodada', async ({ browser }) => {
  test.setTimeout(180_000);
  for (const tabCount of [2, 3, 4]) {
    await f5Tabs(browser, tabCount);
  }
});

async function f5Tabs(browser: Browser, tabCount: number): Promise<void> {
  const context = await browser.newContext();
  try {
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: `f5-${tabCount}`,
        url: 'http://127.0.0.1:5173',
      },
    ]);

    let revoked = false;
    let posts = 0;
    let round = 0;
    let roundPosts = 0;
    let countedRound = -1;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      if (countedRound !== round) {
        countedRound = round;
        roundPosts = 0;
      }
      roundPosts += 1;
      posts += 1;
      if (roundPosts > 1) {
        revoked = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Sessao invalida' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie': `mae_refresh=f5-${tabCount}-${round}-nova; Path=/; HttpOnly`,
        },
        body: JSON.stringify(grant),
      });
    });

    const pages: Page[] = [];
    for (let index = 0; index < tabCount; index += 1) {
      const page = await context.newPage();
      await prepare(page);
      pages.push(page);
    }

    for (let index = 0; index < 5; index += 1) {
      const label = `${tabCount} abas rodada ${index + 1}`;
      const before = posts;
      round = index;
      const pending =
        index === 0
          ? Promise.all(pages.map((page) => page.goto('/app/perfil')))
          : Promise.all(pages.map((page) => page.reload()));
      await pending;
      for (const page of pages) {
        await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace', {
          timeout: 12_000,
        });
        await expect(page).toHaveURL(/\/app\/perfil$/);
      }
      expect(posts - before, label).toBe(1);
      expect(revoked, label).toBe(false);
    }
    const mark = await pages[0].evaluate(() => localStorage.getItem('mae.sessionRefresh'));
    expect(mark ?? '').not.toMatch(/jwt|eyJ|access_token/i);
  } finally {
    await context.close();
  }
}

test('marca órfã no boot não vai para /entrar', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  for (const mode of ['com-locks', 'sem-locks'] as const) {
    for (const tabs of [1, 2]) {
      await orphanBoot(browser, mode, tabs, testInfo);
    }
  }
});

async function orphanBoot(
  browser: Browser,
  mode: 'com-locks' | 'sem-locks',
  tabs: number,
  testInfo: TestInfo,
): Promise<void> {
  const context = await browser.newContext();
  try {
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: `orfa-${mode}-${tabs}`,
        url: 'http://127.0.0.1:5173',
      },
    ]);
    if (mode === 'sem-locks') {
      await context.addInitScript(() => {
        const block = {
          configurable: true,
          get: () => undefined,
        };
        try {
          Object.defineProperty(navigator, 'locks', block);
        } catch {
          Object.defineProperty(Navigator.prototype, 'locks', block);
        }
      });
    }

    const seeder = await context.newPage();
    await seeder.route('**/*', async (route) => {
      if (route.request().resourceType() === 'document') {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>marca</title>',
        });
        return;
      }
      await route.abort();
    });
    await seeder.goto('/');
    await seeder.evaluate(() => {
      localStorage.setItem(
        'mae.sessionRefresh',
        JSON.stringify({ tabId: 'aba-morta-sem-dono', startedAt: Date.now() }),
      );
    });
    await seeder.close();

    let revoked = false;
    let posts = 0;
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      posts += 1;
      if (posts > 1) {
        revoked = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Sessao invalida' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(grant),
      });
    });

    const pages: Page[] = [];
    for (let index = 0; index < tabs; index += 1) {
      const page = await context.newPage();
      await prepare(page);
      pages.push(page);
    }
    await Promise.all(pages.map((page) => page.goto('/app/perfil')));
    for (const page of pages) {
      await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace', {
        timeout: 15_000,
      });
      await expect(page).toHaveURL(/\/app\/perfil$/);
      expect(page.url(), `${mode} ${tabs}`).not.toContain('/entrar');
    }
    const hasLocks = await pages[0].evaluate(() => navigator.locks != null);
    expect(hasLocks, mode).toBe(mode === 'com-locks');
    expect(posts, `${mode} ${tabs} abas`).toBe(1);
    expect(revoked, `${mode} ${tabs} abas`).toBe(false);
    const mark = await pages[0].evaluate(() => localStorage.getItem('mae.sessionRefresh'));
    expect(mark ?? '', `${mode} ${tabs}`).not.toContain('aba-morta-sem-dono');
    expect(mark ?? '', `${mode} ${tabs}`).not.toMatch(/jwt|eyJ|access_token/i);
    if (tabs === 1) {
      await pages[0].screenshot({
        path: testInfo.outputPath(`marca-orfa-${mode}.png`),
        fullPage: true,
      });
    }
  } finally {
    await context.close();
  }
}
