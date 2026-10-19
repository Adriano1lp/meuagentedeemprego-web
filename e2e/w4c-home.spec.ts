import { expect, test, type Page } from './fixtures';

import {
  mockAuthSuccess,
  mockBillingMe,
  mockLegalRoutes,
  mockedStatus,
  mockUploadCv,
  mockUserStatus,
} from './helpers';

const widths = [360, 1280] as const;

async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
  expect(fits).toBe(true);
}

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

function navLink(page: Page, name: string) {
  const width = page.viewportSize()?.width ?? 1280;
  const root =
    width < 768 ? page.getByTestId('app-bottom-nav') : page.getByTestId('app-sidebar');
  return root.getByRole('link', { name });
}

async function revisitHome(page: Page) {
  await navLink(page, 'Perfil').click();
  await expect(page).toHaveURL(/\/app\/perfil$/);
  await navLink(page, 'Início').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('Free, Essencial, esgotado, CV e overflow', async ({ page }, testInfo) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);

  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: true,
    has_embeddings: true,
  });
  await mockBillingMe(page, {
    plan: 'free',
    subscription_status: 'none',
    used: 2,
    limit: 5,
    remaining: 3,
    period: '2026-10',
    period_end: '2026-11-01T00:00:00Z',
  });

  await login(page);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByTestId('status-plan')).toHaveText('Free');
    await expect(page.getByTestId('status-quota')).toHaveText('2 de 5 análises usadas');
    await expect(page.getByTestId('quota-reset')).toHaveText(
      'Sua cota reinicia em 1º de novembro',
    );
    await expect(page.getByTestId('cv-onboarding')).toHaveCount(0);
    await expect(page.getByTestId('processar-panel')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`app-com-cv-${width}.png`),
      fullPage: true,
    });
  }

  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: false,
    has_embeddings: false,
  });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await revisitHome(page);
    await expect(page.getByTestId('cv-onboarding')).toBeVisible();
    await expect(page.getByTestId('cv-create-form')).toBeDisabled();
    await expect(page.getByTestId('cv-create-form-soon')).toHaveText('em breve');
    await expect(page.getByTestId('processar-gate')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`app-sem-cv-${width}.png`),
      fullPage: true,
    });
  }

  await mockBillingMe(page, {
    plan: 'essencial',
    subscription_status: 'active',
    used: 4,
    limit: 30,
    remaining: 26,
    period: '2026-10',
    period_end: '2026-11-01T00:00:00Z',
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await revisitHome(page);
  await expect(page.getByTestId('status-plan')).toHaveText('Essencial');
  await expect(page.getByTestId('status-quota')).toHaveText('4 de 30 análises usadas');
  await expect(page.getByTestId('quota-subscribe')).toHaveCount(0);

  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: true,
    has_embeddings: true,
  });
  await mockBillingMe(page, {
    plan: 'free',
    subscription_status: 'none',
    used: 5,
    limit: 5,
    remaining: 0,
    period: '2026-10',
    period_end: '2026-11-01T00:00:00Z',
  });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await revisitHome(page);
    await expect(page.getByTestId('quota-exhausted')).toBeVisible();
    await expect(page.getByTestId('quota-subscribe')).toHaveText('Assinar Essencial');
    await expect(page.getByTestId('quota-reset')).toHaveText(
      'Sua cota reinicia em 1º de novembro',
    );
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`app-free-esgotado-${width}.png`),
      fullPage: true,
    });
  }

  await mockBillingMe(page, {
    plan: 'essencial',
    subscription_status: 'active',
    used: 30,
    limit: 30,
    remaining: 0,
    period: '2026-12',
    period_end: '2027-01-01T00:00:00Z',
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await revisitHome(page);
  await expect(page.getByTestId('status-plan')).toHaveText('Essencial');
  await expect(page.getByTestId('status-quota')).toHaveText('30 de 30 análises usadas');
  await expect(page.getByTestId('quota-reset')).toHaveText(
    'Sua cota reinicia em 1º de janeiro',
  );
  await expect(page.getByTestId('quota-subscribe')).toHaveCount(0);
  await expect(page.getByTestId('quota-exhausted')).toHaveCount(0);

  await page.getByTestId('shortcut-historico').click();
  await expect(page).toHaveURL(/\/app\/historico$/);
  await navLink(page, 'Início').click();
  await page.getByTestId('shortcut-carta').click();
  await expect(page).toHaveURL(/\/app\/historico$/);
  await navLink(page, 'Início').click();
  await page.getByTestId('shortcut-perfil').click();
  await expect(page).toHaveURL(/\/app\/perfil$/);
  await navLink(page, 'Início').click();
  await page.getByTestId('shortcut-analisar').click();
  await expect(page).toHaveURL(/\/app#analise$/);

  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await navLink(page, width < 768 ? 'Currículo' : 'Meu currículo').click();
    await expect(page.getByTestId('cv-sent')).toHaveText('Currículo enviado');
    await expect(page.getByTestId('cv-replace')).toHaveText('Trocar arquivo');
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`curriculo-${width}.png`),
      fullPage: true,
    });
  }
});

test('nav mobile tem 4 itens e /app/curriculo exige sessao', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/app/curriculo');
  await expect(page.getByTestId('session-expired-notice')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('next')).toBe('/app/curriculo');
  await expect(page.getByTestId('curriculo-page')).toHaveCount(0);

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: true,
    has_embeddings: true,
  });
  await login(page);

  const bottom = page.getByTestId('app-bottom-nav');
  await expect(bottom).toBeVisible();
  await expect(bottom.getByRole('link')).toHaveCount(4);
  const labels = ['Início', 'Histórico', 'Currículo', 'Perfil'];
  for (const label of labels) {
    await expect(bottom.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(bottom.getByRole('link', { name: 'Início' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await bottom.getByRole('link', { name: 'Currículo' }).click();
  await expect(page).toHaveURL(/\/app\/curriculo$/);
  await expect(bottom.getByRole('link', { name: 'Currículo' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('app-sidebar')).toBeHidden();
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('nav-mobile-360.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('app-sidebar')).toBeVisible();
  await expect(page.getByTestId('nav-curriculo')).toHaveText('Meu currículo');
  await expect(page.getByTestId('nav-curriculo')).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('nav-curriculo-1280.png'),
    fullPage: true,
  });
});

test('nome longo do currículo em 360 não gera scroll horizontal', async ({ page }, testInfo) => {
  const longName = 'Currículo (versão final) cv-novo.pdf '.repeat(8).trim();
  await page.setViewportSize({ width: 360, height: 800 });
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: true,
    has_embeddings: true,
  });
  await mockUploadCv(page, () => ({
    body: {
      filename: longName,
      updated_at: '2026-10-18T18:40:56Z',
      has_cv: true,
      has_embeddings: true,
      ready_for_analysis: true,
      reason: 'POST json main.py Request Entity',
    },
  }));

  await login(page);
  await navLink(page, 'Currículo').click();
  await expect(page.getByTestId('curriculo-page')).toBeVisible();
  await page.getByTestId('cv-replace').click();
  await page.getByTestId('cv-file').setInputFiles({
    name: longName,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await expect(page.getByTestId('cv-filename')).toContainText('Currículo (versão final)');
  await expect(page.getByTestId('cv-filename')).not.toHaveClass(/break-all/);
  expect(await page.getByTestId('cv-filename').evaluate((el) => el.outerHTML)).not.toContain(
    'break-all',
  );
  expect(
    await page.getByTestId('cv-filename').evaluate((el) => getComputedStyle(el).wordBreak),
  ).not.toBe('break-all');
  await expectNoHorizontalScroll(page);

  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-saved-filename')).toContainText(
    `Currículo atualizado. Nome do arquivo: ${longName}`,
  );
  await expect(page.getByTestId('cv-saved-filename')).toContainText('(versão');
  expect(
    await page.getByTestId('cv-saved-filename').evaluate((el) => el.outerHTML),
  ).not.toContain('break-all');
  expect(
    await page.getByTestId('cv-saved-filename').evaluate((el) => getComputedStyle(el).wordBreak),
  ).not.toBe('break-all');
  await expect(page.getByTestId('cv-saved-updated-at')).toHaveText(
    'Atualizado em 18/10/2026 às 15h40',
  );
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('curriculo-nome-longo-360.png'),
    fullPage: true,
  });
});
