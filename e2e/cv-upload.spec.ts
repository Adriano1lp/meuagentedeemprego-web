import { expect, test } from '@playwright/test';

import {
  mockAuthSuccess,
  mockedDocxCv,
  mockedEmptyCv,
  mockedPdfCv,
  mockedStatus,
  mockLegalRoutes,
  mockRebuildEmbeddings,
  mockUploadCv,
  mockUserStatus,
} from './helpers';

const vagaTexto =
  'Vaga para desenvolvedor Python com requisitos e responsabilidades.';

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('1. Happy PDF: upload + rebuild OK → pronto → Analisar enabled', async ({
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
        filename: 'cv.pdf',
        bytes_received: 18,
        updated_at: '2026-09-14T12:00:00+00:00',
      },
    };
  });
  await mockRebuildEmbeddings(page, async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    hasEmbeddings = true;
    return {
      body: {
        chunks: 4,
        processed_at: '2026-09-14T12:01:00+00:00',
        embedding_model: 'text-embedding-3-small',
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
  await expect(page.getByTestId('cv-panel')).toHaveAttribute(
    'data-cv-state',
    'idle',
  );
  await expect(page.getByTestId('processar-submit')).toBeDisabled();

  await page.getByTestId('cv-file').setInputFiles(mockedPdfCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-rebuilding')).toContainText(
    'Reconstruindo embeddings',
  );
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await expect(page.getByTestId('cv-ready')).toContainText('Pronto');
  await expect(page.getByTestId('cv-panel')).toHaveAttribute(
    'data-cv-state',
    'pronto',
  );
  await expect(page.getByTestId('status-cv')).toHaveText('sim');
  await expect(page.getByTestId('status-embeddings')).toContainText(
    'prontos para analisar',
  );
  await page.getByTestId('processar-texto').fill(vagaTexto);
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
  expect(flow.indexOf('rebuild-embeddings')).toBeGreaterThan(
    flow.indexOf('upload-cv'),
  );
  expect(flow.slice(flow.indexOf('rebuild-embeddings') + 1)).toContain('status');
});

test('2. Invalid format: .docx ou vazio → API 400 → UI erro → Analisar disabled', async ({
  page,
}) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: false,
    has_embeddings: false,
  });
  await mockUploadCv(page, () => ({
    status: 400,
    body: {
      detail: 'Formato de arquivo invalido. Envie um arquivo .txt ou .pdf',
    },
  }));
  await mockRebuildEmbeddings(page, () => ({
    status: 500,
    body: { detail: 'nao deveria rebuildar' },
  }));

  await page.goto('/');
  await login(page);
  await page.getByTestId('cv-file').setInputFiles(mockedDocxCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Formato de arquivo invalido',
  );
  await expect(page.getByTestId('cv-retry')).toBeVisible();
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await expect(page.getByTestId('cv-panel')).toHaveAttribute(
    'data-cv-state',
    'erro',
  );

  await mockUploadCv(page, () => ({
    status: 400,
    body: { detail: 'Arquivo enviado esta vazio' },
  }));
  await page.getByTestId('cv-file').setInputFiles(mockedEmptyCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Arquivo enviado esta vazio',
  );
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await expect(page.getByTestId('cv-ready')).toHaveCount(0);
});

test('3. Rebuild fails: upload OK, rebuild 400 → UI erro + retry → Analisar disabled', async ({
  page,
}) => {
  let uploadHits = 0;
  let rebuildHits = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: true,
    has_embeddings: false,
  });
  await mockUploadCv(page, () => {
    uploadHits += 1;
    return {
      body: {
        filename: 'cv.pdf',
        bytes_received: 18,
        updated_at: '2026-09-14T12:00:00+00:00',
      },
    };
  });
  await mockRebuildEmbeddings(page, () => {
    rebuildHits += 1;
    return {
      status: 400,
      body: {
        detail:
          'Nao foi possivel gerar chunks validos para o curriculo enviado',
      },
    };
  });

  await page.goto('/');
  await login(page);
  await page.getByTestId('cv-file').setInputFiles(mockedPdfCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Nao foi possivel gerar chunks validos',
  );
  await expect(page.getByTestId('cv-retry')).toBeVisible();
  expect(uploadHits).toBe(1);
  expect(rebuildHits).toBe(1);
  await page.getByTestId('cv-retry').click();
  await expect(page.getByTestId('cv-error')).toBeVisible();
  expect(uploadHits).toBe(1);
  expect(rebuildHits).toBe(2);
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
});

test('4. Already ready: status has_cv+has_embeddings → pronto sem reupload', async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.endsWith('/users/me/upload-cv') ||
      pathname.endsWith('/users/me/rebuild-embeddings')
    ) {
      uploads.push(pathname);
    }
  });
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await page.goto('/');
  await login(page);

  await expect(page.getByTestId('cv-ready')).toContainText('Pronto');
  await expect(page.getByTestId('cv-panel')).toHaveAttribute(
    'data-cv-state',
    'pronto',
  );
  expect(uploads).toEqual([]);
  await page.getByTestId('processar-texto').fill(vagaTexto);
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
});

test('5. No CV / has_embeddings false: texto preenchido → Analisar disabled', async ({
  page,
}) => {
  const processarHits: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/processar')) {
      processarHits.push(request.url());
    }
  });
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: false,
    has_embeddings: false,
  });
  await page.goto('/');
  await login(page);

  await expect(page.getByTestId('cv-missing')).toBeVisible();
  await page.getByTestId('processar-texto').fill(vagaTexto);
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await page.getByTestId('processar-submit').click({ force: true });
  expect(processarHits).toEqual([]);
});
