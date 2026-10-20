import type { BrowserContext } from '@playwright/test';

import { expectExpiredLogin, mockAuthSuccess, mockCurrentUser, mockLegalRoutes } from './helpers';
import { expect, test, type Page } from './fixtures';

const grant = {
  access_token: 'jwt-refresh',
  token_type: 'bearer',
  expires_in: 3600,
};

/**
 * Segura o Web Lock até as duas abas terem o canal aberto. Assim o
 * refreshing do líder chega na outra antes do POST.
 */
async function gateBothTabs(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const locks = navigator.locks;
    if (!locks) {
      return;
    }
    const key = 'mae-e2e-lock-tabs';
    const epochKey = 'mae-e2e-lock-epoch';
    const id = `${Date.now()}-${Math.random()}`;
    type Mark = { id: string; at: number };
    const read = (): Mark[] => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]') as unknown;
        if (!Array.isArray(parsed)) {
          return [];
        }
        return parsed.filter(
          (item): item is Mark =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as Mark).id === 'string' &&
            typeof (item as Mark).at === 'number',
        );
      } catch {
        return [];
      }
    };
    const write = (marks: Mark[]) => {
      localStorage.setItem(key, JSON.stringify(marks));
    };
    window.addEventListener('pagehide', () => {
      write(read().filter((item) => item.id !== id));
    });
    const original = locks.request.bind(locks);
    locks.request = ((name: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      return new Promise((resolve, reject) => {
        const wait = () => {
          const epoch = Number(localStorage.getItem(epochKey) || '0');
          const now = Date.now();
          const marks = read().filter((item) => item.id !== id && item.at >= epoch);
          write([...marks, { id, at: now }]);
          if (marks.length + 1 >= 2) {
            const pending = maybeCallback
              ? original(name, optionsOrCallback as LockOptions, maybeCallback as LockGrantedCallback)
              : original(name, optionsOrCallback as LockGrantedCallback);
            Promise.resolve(pending).then(resolve, reject);
            return;
          }
          window.setTimeout(wait, 20);
        };
        wait();
      });
    }) as typeof locks.request;
  });
}

async function bumpEpoch(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('mae-e2e-lock-epoch', String(Date.now()));
  });
}

async function isBooting(page: Page): Promise<boolean> {
  return page
    .evaluate(() => document.querySelector('[data-testid="session-boot"]') != null)
    .catch(() => false);
}

test('com locks, fechar a aba líder no POST lento não manda o segundo refresh', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const context = await browser.newContext();
  let release = () => {};
  let aborted = false;
  try {
    await gateBothTabs(context);
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: 'lider-morre',
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
    for (const tab of [pageA, pageB]) {
      await mockLegalRoutes(tab);
      await mockAuthSuccess(tab);
      await mockCurrentUser(tab);
    }
    const navA = pageA.goto('/app/perfil');
    const navB = pageB.goto('/app/perfil');
    await expect
      .poll(() => pageA.evaluate(() => navigator.locks != null).catch(() => false), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(1);
    await expect
      .poll(async () => [await isBooting(pageA), await isBooting(pageB)], { timeout: 15_000 })
      .toEqual([true, true]);
    await pageA.waitForTimeout(500);

    expect(leader).not.toBeNull();
    const survivor = leader === pageA ? pageB : pageA;
    aborted = true;
    await leader!.close({ runBeforeUnload: false });

    await expect(survivor).toHaveURL(/\/entrar\?/, { timeout: 12_000 });
    expectExpiredLogin(survivor, '/app/perfil');
    expect(revoked).toBe(false);
    expect(attempts).toBe(1);
    await survivor.waitForTimeout(1_000);
    expect(attempts).toBe(1);
    expect(revoked).toBe(false);

    await Promise.allSettled([navA, navB]);
  } finally {
    aborted = true;
    release();
    await context.close();
  }
});

test('com locks, 3 F5 seguidos fazem no máximo um POST e não derrubam a sessão', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  let release = () => {};
  try {
    await gateBothTabs(context);
    await context.addCookies([
      {
        name: 'mae_refresh',
        value: 'f5-0',
        url: 'http://127.0.0.1:5173',
      },
    ]);

    let revoked = false;
    let posts = 0;
    let generation = 0;
    const seen = new Map<number, number>();
    const armGate = () => {
      let open = () => {};
      const promise = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { promise, open };
    };
    let gate = armGate();
    release = () => gate.open();
    await context.route('**/auth/refresh', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      const gen = generation;
      const next = (seen.get(gen) ?? 0) + 1;
      seen.set(gen, next);
      if (revoked || next > 1) {
        revoked = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Sessao invalida' }),
        });
        return;
      }
      const current = gate;
      posts += 1;
      await current.promise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie': `mae_refresh=f5-${gen + 1}; Path=/; HttpOnly`,
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
    for (let index = 0; index < 3; index += 1) {
      const before = posts;
      if (index > 0) {
        generation += 1;
        await bumpEpoch(pageA);
      }
      const pending =
        index === 0
          ? Promise.all([pageA.goto('/app/perfil'), pageB.goto('/app/perfil')])
          : Promise.all([pageA.reload(), pageB.reload()]);
      await expect
        .poll(() => pageA.evaluate(() => navigator.locks != null).catch(() => false), {
          timeout: 15_000,
        })
        .toBe(true);
      await expect.poll(() => posts, { timeout: 15_000 }).toBe(before + 1);
      await expect
        .poll(async () => [await isBooting(pageA), await isBooting(pageB)], { timeout: 15_000 })
        .toEqual([true, true]);
      await pageA.waitForTimeout(500);
      const done = gate.open;
      gate = armGate();
      release = () => gate.open();
      done();
      await pending;
      await expect(pageA.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 12_000 });
      await expect(pageB.getByTestId('profile-name')).toHaveText('Ada Lovelace', { timeout: 12_000 });
      await expect(pageA).toHaveURL(/\/app\/perfil$/);
      await expect(pageB).toHaveURL(/\/app\/perfil$/);
      expect(posts, `rodada ${index + 1}`).toBe(before + 1);
      expect(revoked, `rodada ${index + 1}`).toBe(false);
    }
    expect(posts).toBe(3);
    expect(revoked).toBe(false);
  } finally {
    release();
    await context.close();
  }
});
