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

test('1. Happy PDF: upload sincrono libera Analisar sem rebuild automatico', async ({
  page,
}) => {
  let hasCv = false;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, () => ({
    ...mockedStatus,
    has_cv: hasCv,
    has_embeddings: hasCv,
  }));
  await mockUploadCv(page, () => {
    hasCv = true;
    return {
      body: {
        filename: 'cv.pdf',
        bytes_received: 18,
        updated_at: '2026-09-14T12:00:00+00:00',
        has_cv: true,
        has_embeddings: true,
        ready_for_analysis: true,
      },
    };
  });
  await mockRebuildEmbeddings(page, () => ({
    status: 500,
    body: { detail: 'nao deveria rebuildar' },
  }));

  await page.goto('/entrar');
  await login(page);
  await expect(page.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'idle');
  await expect(page.getByTestId('processar-submit')).toBeDisabled();

  await page.getByTestId('cv-file').setInputFiles(mockedPdfCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-onboarding')).toHaveCount(0);
  await page.getByTestId('processar-texto').fill(vagaTexto);
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
});

test('2. Invalid format: .docx ou vazio → API 400 → UI erro → Analisar disabled', async ({
  page,
}) => {
  let uploadHits = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: false,
    has_embeddings: false,
  });
  await mockUploadCv(page, () => {
    uploadHits += 1;
    return {
      status: 400,
      body: {
        detail: 'Formato de arquivo invalido. Envie um arquivo .txt ou .pdf',
      },
    };
  });

  await page.goto('/entrar');
  await login(page);
  await page.getByTestId('cv-file').setInputFiles(mockedDocxCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Não conseguimos ler esse arquivo. Envie um PDF ou TXT com texto.',
  );
  await expect(page.getByTestId('cv-retry')).toBeVisible();
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await expect(page.getByTestId('cv-panel')).toHaveAttribute('data-cv-state', 'erro');

  await mockUploadCv(page, () => {
    uploadHits += 1;
    return {
      status: 400,
      body: { detail: 'Arquivo enviado esta vazio' },
    };
  });
  await page.getByTestId('cv-file').setInputFiles(mockedEmptyCv);
  await page.getByTestId('cv-submit').click();
  await expect.poll(() => uploadHits).toBe(2);
  await expect(page.getByTestId('cv-error')).toContainText(
    'Não conseguimos ler esse arquivo. Envie um PDF ou TXT com texto.',
  );
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await expect(page.getByTestId('cv-success')).toHaveCount(0);
});

test('3. ready_for_analysis false: erro + retry de rebuild → Analisar disabled', async ({
  page,
}) => {
  let uploadHits = 0;
  let rebuildHits = 0;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    has_cv: false,
    has_embeddings: false,
  });
  await mockUploadCv(page, () => {
    uploadHits += 1;
    return {
      body: {
        filename: 'cv.pdf',
        bytes_received: 18,
        updated_at: '2026-09-14T12:00:00+00:00',
        has_cv: true,
        has_embeddings: false,
        ready_for_analysis: false,
      },
    };
  });
  await mockRebuildEmbeddings(page, () => {
    rebuildHits += 1;
    return {
      status: 400,
      body: {
        detail: 'Nao foi possivel gerar chunks validos para o curriculo enviado',
      },
    };
  });

  await page.goto('/entrar');
  await login(page);
  await page.getByTestId('cv-file').setInputFiles(mockedPdfCv);
  await page.getByTestId('cv-submit').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Não conseguimos processar seu currículo. Tente de novo.',
  );
  await expect(page.getByTestId('cv-retry')).toBeVisible();
  expect(uploadHits).toBe(1);
  expect(rebuildHits).toBe(0);
  await page.getByTestId('cv-retry').click();
  await expect(page.getByTestId('cv-error')).toContainText(
    'Não conseguimos processar seu currículo. Envie o arquivo de novo.',
  );
  expect(uploadHits).toBe(1);
  expect(rebuildHits).toBe(1);
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
});

test('4. Com CV a home mostra a analise e nao pede reupload', async ({ page }) => {
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
  await page.goto('/entrar');
  await login(page);

  await expect(page.getByTestId('cv-onboarding')).toHaveCount(0);
  await expect(page.getByTestId('processar-panel')).toBeVisible();
  expect(uploads).toEqual([]);
  await page.getByTestId('processar-texto').fill(vagaTexto);
  await expect(page.getByTestId('processar-submit')).toBeEnabled();
});

test('5. Sem CV a analise fica bloqueada', async ({ page }) => {
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
  await page.goto('/entrar');
  await login(page);

  await expect(page.getByTestId('cv-onboarding')).toBeVisible();
  await expect(page.getByTestId('cv-create-form')).toBeDisabled();
  await expect(page.getByTestId('processar-gate')).toContainText(
    'Envie um currículo para liberar a análise de vaga.',
  );
  await page.getByTestId('processar-texto').fill(vagaTexto);
  await expect(page.getByTestId('processar-submit')).toBeDisabled();
  await page.getByTestId('processar-submit').click({ force: true });
  expect(processarHits).toEqual([]);
});
