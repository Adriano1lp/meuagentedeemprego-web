import { expect, test } from '@playwright/test';

import {
  mockAuthSuccess,
  mockedPdfCv,
  mockedStatus,
  mockLegalRoutes,
  mockRebuildEmbeddings,
  mockUploadCv,
  mockUserStatus,
} from './helpers';

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('1. sem CV valido bloqueia Analisar vaga', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: false,
    has_embeddings: false,
  });
  await page.goto('/');
  await login(page);

  await expect(page.getByTestId('cv-missing')).toContainText(
    'Sem curriculo valido',
  );
  await expect(page.getByTestId('processar-gate')).toContainText(
    'Sem curriculo valido',
  );
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await expect(page.getByTestId('cv-ready')).toHaveCount(0);
});

test('2. upload ok: processando embeddings e depois pronto', async ({
  page,
}) => {
  let hasCv = false;
  let hasEmbeddings = false;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, () => ({
    ...mockedStatus,
    has_cv: hasCv,
    has_embeddings: hasEmbeddings,
  }));
  await mockUploadCv(page, () => {
    hasCv = true;
    return {
      body: {
        user_id: 'user-1',
        document_id: 'doc-1',
        filename: 'cv.pdf',
        content_type: 'application/pdf',
        bytes_received: 18,
      },
    };
  });
  await mockRebuildEmbeddings(page, async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    hasEmbeddings = true;
    return {
      body: {
        user_id: 'user-1',
        chunks: 4,
        vector_store: 'mongodb',
        processed_at: '2026-09-14T12:01:00+00:00',
      },
    };
  });

  const flow: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/users/me/upload-cv')) {
      flow.push('upload-cv');
    } else if (pathname.endsWith('/users/me/rebuild-embeddings')) {
      flow.push('rebuild-embeddings');
    } else if (pathname.endsWith('/users/me/status')) {
      flow.push('status');
    }
  });

  await page.goto('/');
  await login(page);
  await expect(page.getByTestId('cv-missing')).toBeVisible();
  await expect(page.getByTestId('processar-submit')).toBeDisabled();

  await page.getByTestId('cv-file').setInputFiles(mockedPdfCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-processing')).toContainText(
    'Processando embeddings',
  );
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await expect(page.getByTestId('cv-ready')).toContainText('Pronto');
  await expect(page.getByTestId('processar-gate')).toHaveCount(0);

  await page.getByTestId('processar-texto').fill(
    'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
  );
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
  const uploadAt = flow.indexOf('upload-cv');
  const rebuildAt = flow.indexOf('rebuild-embeddings');
  expect(uploadAt).toBeGreaterThanOrEqual(0);
  expect(rebuildAt).toBeGreaterThan(uploadAt);
  expect(flow.slice(rebuildAt + 1)).toContain('status');
});

test('3. erro de upload mostra retry e reenvia', async ({ page }) => {
  let failUpload = true;
  let hasCv = false;
  let hasEmbeddings = false;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, () => ({
    ...mockedStatus,
    has_cv: hasCv,
    has_embeddings: hasEmbeddings,
  }));
  await mockUploadCv(page, () => {
    if (failUpload) {
      return {
        status: 400,
        body: { detail: 'Nao foi possivel extrair texto do arquivo enviado' },
      };
    }
    hasCv = true;
    return { body: { filename: 'cv.pdf' } };
  });
  await mockRebuildEmbeddings(page, () => {
    hasEmbeddings = true;
    return { body: { chunks: 2 } };
  });

  await page.goto('/');
  await login(page);
  await page.getByTestId('cv-file').setInputFiles(mockedPdfCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Nao foi possivel extrair texto',
  );
  await expect(page.getByTestId('processar-submit')).toBeDisabled();

  failUpload = false;
  await page.getByTestId('cv-retry').click();
  await expect(page.getByTestId('cv-ready')).toBeVisible();
  await page.getByTestId('processar-texto').fill(
    'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
  );
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
});

test('3b. erro de embeddings mostra retry so do rebuild', async ({ page }) => {
  let failRebuild = true;
  let hasCv = false;
  let hasEmbeddings = false;
  let uploadHits = 0;
  let rebuildHits = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, () => ({
    ...mockedStatus,
    has_cv: hasCv,
    has_embeddings: hasEmbeddings,
  }));
  await mockUploadCv(page, () => {
    uploadHits += 1;
    hasCv = true;
    return { body: { filename: 'cv.pdf' } };
  });
  await mockRebuildEmbeddings(page, () => {
    rebuildHits += 1;
    if (failRebuild) {
      return {
        status: 400,
        body: {
          detail:
            'Nao foi possivel gerar chunks validos para o curriculo enviado',
        },
      };
    }
    hasEmbeddings = true;
    return { body: { chunks: 5 } };
  });

  await page.goto('/');
  await login(page);
  await page.getByTestId('cv-file').setInputFiles(mockedPdfCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Nao foi possivel gerar chunks validos',
  );
  expect(uploadHits).toBe(1);
  expect(rebuildHits).toBe(1);

  failRebuild = false;
  await page.getByTestId('cv-retry').click();
  await expect(page.getByTestId('cv-ready')).toBeVisible();
  expect(uploadHits).toBe(1);
  expect(rebuildHits).toBe(2);
  await page.getByTestId('processar-texto').fill(
    'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
  );
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
});

test('4. has_embeddings no status habilita Analisar vaga', async ({
  page,
}) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await page.goto('/');
  await login(page);

  await expect(page.getByTestId('cv-ready')).toContainText('Pronto');
  await expect(page.getByTestId('processar-gate')).toHaveCount(0);
  await page.getByTestId('processar-texto').fill(
    'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
  );
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
});
