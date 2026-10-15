import { expect, test, type Page } from '@playwright/test';

import {
  mockAuthSuccess,
  mockCurrentUser,
  mockGapHistory,
  mockLegalRoutes,
  mockedHistoryItem,
} from './helpers';

const widths = [360, 1280] as const;

async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
  expect(fits).toBe(true);
}

function isMobile(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

async function expectShell(
  page: Page,
  active: 'Inicio' | 'Historico' | 'Perfil',
) {
  const sidebar = page.getByTestId('app-sidebar');
  const bottom = page.getByTestId('app-bottom-nav');

  if (isMobile(page)) {
    await expect(sidebar).toBeHidden();
    await expect(bottom).toBeVisible();
    await expect(bottom).toHaveAttribute('aria-label', 'Principal');
    await expect(bottom.getByRole('link', { name: active })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const paddingBottom = await page.locator('main').evaluate((element) => {
      return Number.parseFloat(getComputedStyle(element).paddingBottom);
    });
    expect(paddingBottom).toBeGreaterThanOrEqual(76);
    return;
  }

  await expect(sidebar).toBeVisible();
  await expect(bottom).toBeHidden();
  await expect(
    sidebar.getByRole('navigation', { name: 'Principal' }),
  ).toBeVisible();
  await expect(sidebar.getByRole('link', { name: active })).toHaveAttribute(
    'aria-current',
    'page',
  );
}

async function expectSidebarFillsViewport(page: Page) {
  const metrics = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]');
    if (!(sidebar instanceof HTMLElement)) {
      return null;
    }
    const rect = sidebar.getBoundingClientRect();
    const main = document.querySelector('main');
    return {
      height: rect.height,
      innerHeight: window.innerHeight,
      mainLeft: main instanceof HTMLElement ? main.getBoundingClientRect().left : 0,
      sidebarRight: rect.right,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  expect(metrics).not.toBeNull();
  expect(metrics!.height).toBe(metrics!.innerHeight);
  expect(metrics!.mainLeft).toBeGreaterThanOrEqual(metrics!.sidebarRight - 1);
  expect(metrics!.scrollWidth).toBeLessThanOrEqual(metrics!.clientWidth);
}

async function login(page: Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

for (const width of widths) {
  test(`telas sem rolagem horizontal e shell em ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await mockLegalRoutes(page);
    await mockAuthSuccess(page);
    await mockCurrentUser(page);
    await mockGapHistory(page, () => ({
      body: { items: [mockedHistoryItem], limit: 20, offset: 0 },
    }));

    await page.goto('/');
    await expect(page.getByTestId('landing-page')).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('app-bottom-nav')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`landing-${width}.png`),
    });

    await page.goto('/entrar');
    await expect(page.getByTestId('auth-tab-login')).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('app-bottom-nav')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`entrar-${width}.png`),
    });

    await page.getByTestId('auth-tab-signup').click();
    await expect(page.getByTestId('termsDocumentText')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByTestId('auth-tab-login').click();

    await login(page);
    await expect(page).toHaveURL(/\/app$/);
    await expectShell(page, 'Inicio');
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`inicio-${width}.png`),
    });

    const historico = isMobile(page)
      ? page.getByTestId('app-bottom-nav').getByRole('link', { name: 'Historico' })
      : page.getByTestId('nav-historico');
    await historico.click();
    await expect(page.getByTestId('history-panel')).toBeVisible();
    await expectShell(page, 'Historico');
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`historico-${width}.png`),
    });

    const perfil = isMobile(page)
      ? page.getByTestId('app-bottom-nav').getByRole('link', { name: 'Perfil' })
      : page.getByTestId('nav-perfil');
    await perfil.click();
    await expect(page.getByTestId('profile-name')).toBeVisible();
    await expectShell(page, 'Perfil');
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`perfil-${width}.png`),
    });
  });
}

test('sidebar ocupa a viewport em 1280px na pagina curta e depois da rolagem', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await mockGapHistory(page, () => ({ body: [] }));

  await page.goto('/entrar');
  await login(page);

  const scrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight,
  );
  expect(scrolls).toBe(true);
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.scrollY + window.innerHeight >=
          document.documentElement.scrollHeight - 1,
      ),
    )
    .toBe(true);
  await expectSidebarFillsViewport(page);
  await page.screenshot({
    path: testInfo.outputPath('sidebar-rolada-1280.png'),
  });

  await page.getByTestId('nav-historico').click();
  await expect(page.getByTestId('history-empty')).toBeVisible();
  const fits = await page.evaluate(
    () => document.documentElement.scrollHeight <= window.innerHeight,
  );
  expect(fits).toBe(true);
  await expectSidebarFillsViewport(page);
  await page.screenshot({
    path: testInfo.outputPath('sidebar-curta-1280.png'),
  });

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByTestId('app-sidebar')).toBeHidden();
  await expect(page.getByTestId('app-bottom-nav')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('shell-360.png'),
  });
});
