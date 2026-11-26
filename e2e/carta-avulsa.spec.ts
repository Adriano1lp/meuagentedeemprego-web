import { expect, test, type Page } from './fixtures';

import {
  mockAuthSuccess,
  mockCoverLetter,
  mockLegalRoutes,
  mockedPdfBytes,
  mockedStatus,
  mockUserFile,
  mockUserStatus,
} from './helpers';

const letterText = 'Ola, equipe da Acme.\nTenho interesse na vaga.\n\nAtenciosamente.';

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
  expect(fits).toBe(true);
}

test('gera a carta só com a empresa e baixa o PDF', async ({ page }, testInfo) => {
  const coverPosts: Array<{ empresa: unknown; keys: string[]; authorization?: string }> = [];
  const fileGets: string[] = [];

  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/users/me/cover-letter')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      coverPosts.push({
        empresa: body.empresa,
        keys: Object.keys(body),
        authorization: request.headers().authorization,
      });
      expect(request.url()).not.toContain('jwt-login');
      expect(request.url()).not.toContain('token=');
    }
    if (request.url().includes('/users/me/files/')) {
      fileGets.push(request.url());
      expect(request.headers().authorization).toBe('Bearer jwt-login');
      expect(request.url()).not.toContain('jwt-login');
      expect(request.url()).not.toContain('token=');
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCoverLetter(page, (empresa) => ({
    body: {
      texto_resposta: letterText,
      pdf_url: '/users/me/files/carta-acme.pdf',
      user_id: 'user-1',
      empresa,
    },
  }));
  await mockUserFile(page, { body: mockedPdfBytes });

  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.getByTestId('shortcut-carta').click();
  await expect(page).toHaveURL(/\/app\/carta$/);
  await expect(page.getByTestId('carta-page')).toBeVisible();
  await expect(page.getByLabel('Empresa')).toBeVisible();
  await expect(page.getByLabel(/cargo/i)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('carta-avulsa-vazia-360.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId('cover-letter-company').fill('  Acme  ');
  await page.getByTestId('cover-letter-generate').click();
  await expect(page.getByTestId('cover-letter-text')).toHaveText(letterText);
  expect(coverPosts).toEqual([
    { empresa: 'Acme', keys: ['empresa'], authorization: 'Bearer jwt-login' },
  ]);
  await expect(page.getByTestId('cover-letter-quota')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('carta-avulsa-sucesso-1280.png'),
    fullPage: true,
  });

  await page.getByTestId('cover-letter-download').click();
  await expect(page.getByTestId('cover-letter-download-success')).toBeVisible();
  expect(fileGets.some((url) => url.includes('/users/me/files/carta-acme.pdf'))).toBe(true);

  const stored = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(stored.session).toBe('{}');
  expect(stored.local).not.toContain('Acme');
  expect(stored.local).not.toContain('Tenho interesse');
  expect(stored.local).not.toMatch(
    /cv_file|original_file|object_key|chroma_dir|vector_store|extracted_text_object_key|jwt-login/i,
  );
});

test('sem embeddings orienta o currículo e não chama a carta', async ({ page }, testInfo) => {
  let coverPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/users/me/cover-letter')) {
      coverPosts += 1;
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: true,
    has_embeddings: false,
  });
  await mockCoverLetter(page, () => ({
    body: {
      texto_resposta: letterText,
      pdf_url: '/users/me/files/carta-acme.pdf',
      user_id: 'user-1',
    },
  }));

  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.getByTestId('shortcut-carta').click();
  await expect(page.getByTestId('cover-letter-cv-gate')).toBeVisible();
  await expect(page.getByTestId('cover-letter-cv-gate')).toContainText(
    'Envie ou complete o currículo para gerar a carta.',
  );
  await page.getByTestId('cover-letter-company').fill('Acme');
  await expect(page.getByTestId('cover-letter-generate')).toBeDisabled();
  await page.getByTestId('cover-letter-generate').click({ force: true });
  expect(coverPosts).toBe(0);
  await expect(page.getByTestId('cover-letter-company')).toHaveValue('Acme');
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath('carta-avulsa-sem-embeddings-360.png'),
    fullPage: true,
  });

  await page.getByTestId('cover-letter-cv-link').click();
  await expect(page).toHaveURL(/\/app\/curriculo$/);
  await expect(page.getByTestId('curriculo-page')).toBeVisible();
  expect(coverPosts).toBe(0);
});
