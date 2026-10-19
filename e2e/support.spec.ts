import { expect, test, type Locator, type Page } from './fixtures';

import { supportMailto } from '../src/config/support';
import {
  mockAuthSuccess,
  mockCurrentUser,
  mockLegalRoutes,
} from './helpers';

const widths = [360, 1280] as const;
const EXACT_HREF = 'mailto:clickredeonline@gmail.com?subject=Suporte%20MAE';

async function reveal(locator: Locator) {
  await locator.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}

async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
  expect(fits).toBe(true);
}

async function expectExactSupportHref(page: Page, testId: string) {
  const link = page.getByTestId(testId);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', EXACT_HREF);
  const href = await link.getAttribute('href');
  expect(href).toBe(supportMailto());
  expect(href).not.toContain('body=');
  expect(href).not.toContain('ada@example.com');
  expect(href).not.toContain('Ada');
  expect(href?.startsWith('mailto:')).toBe(true);
  return link;
}

async function login(page: Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test.beforeAll(() => {
  expect(supportMailto()).toBe(EXACT_HREF);
});

for (const width of widths) {
  test(`suporte com href fixo e sem rolagem horizontal em ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await mockLegalRoutes(page);
    await mockAuthSuccess(page);
    await mockCurrentUser(page);
    await page.route('**/users/me/status', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'indisponivel' }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('landing-page')).toBeVisible();
    const landing = await expectExactSupportHref(page, 'support-link-landing');
    await expect(landing).toContainText('Suporte:');
    await expectNoHorizontalScroll(page);
    await reveal(landing);
    await page.screenshot({
      path: testInfo.outputPath(`suporte-landing-${width}.png`),
    });

    await page.goto('/entrar');
    const entrar = await expectExactSupportHref(page, 'support-link-entrar');
    await expect(entrar).toHaveText('Problemas para entrar? Fale com o suporte');
    await expectNoHorizontalScroll(page);
    await reveal(entrar);
    if (width === 1280) {
      for (let step = 0; step < 12; step += 1) {
        if (await entrar.evaluate((element) => element === document.activeElement)) {
          break;
        }
        await page.keyboard.press('Tab');
      }
      await expect(entrar).toBeFocused();
      const focus = await entrar.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        };
      });
      const ring =
        (focus.outlineStyle !== 'none' && focus.outlineWidth !== '0px') ||
        (focus.boxShadow !== 'none' && focus.boxShadow.length > 0);
      expect(ring).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`suporte-entrar-${width}.png`),
    });

    await login(page);
    await expect(page.getByTestId('home-status-error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    const errorLink = await expectExactSupportHref(page, 'support-link-error');
    await expect(errorLink).toHaveText('Se continuar, fale com o suporte');
    await expectNoHorizontalScroll(page);
    await reveal(errorLink);
    await page.screenshot({
      path: testInfo.outputPath(`suporte-erro-${width}.png`),
    });

    if (width < 768) {
      await expect(page.getByTestId('app-sidebar')).toBeHidden();
      await page.getByTestId('app-bottom-nav').getByRole('link', { name: 'Perfil' }).click();
      await expect(page.getByTestId('profile-page')).toBeVisible();
      const profile = await expectExactSupportHref(page, 'support-link-profile');
      await expect(profile).toHaveText('Ajuda e suporte');
      await expect(page.getByTestId('support-link-sidebar')).toBeHidden();
      await expectNoHorizontalScroll(page);
      await reveal(profile);
      await page.screenshot({
        path: testInfo.outputPath(`suporte-menu-${width}.png`),
      });
    } else {
      const sidebar = await expectExactSupportHref(page, 'support-link-sidebar');
      await expect(sidebar).toHaveText('Ajuda e suporte');
      await expect(page.getByTestId('support-link-profile')).toHaveCount(0);
      await page.getByTestId('nav-perfil').click();
      await expect(page.getByTestId('profile-page')).toBeVisible();
      await expect(page.getByTestId('support-link-profile')).toBeHidden();
      await expect(sidebar).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({
        path: testInfo.outputPath(`suporte-menu-${width}.png`),
      });
    }
  });
}
