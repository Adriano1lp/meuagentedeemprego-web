import { expect, test } from '@playwright/test';

import {
  mockAuthSuccess,
  mockGapHistory,
  mockLegalRoutes,
  mockOutdatedMe,
  mockedHistoryItem,
} from './helpers';

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('1. logado + 200 com items → lista das minhas analises', async ({
  page,
}) => {
  const historyUrls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/users/me/gap-history')) {
      historyUrls.push(request.url());
      expect(request.headers().authorization).toBe('Bearer jwt-login');
      expect(request.headers()['x-user-id']).toBeUndefined();
    }
  });

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    body: { items: [mockedHistoryItem], limit: 20, offset: 0 },
  }));
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();

  await expect(page.getByTestId('history-list')).toBeVisible();
  await expect(page.getByTestId('history-item-title')).toHaveText(
    'Desenvolvedor Flutter',
  );
  await expect(page.getByTestId('history-item-company')).toContainText('Acme');
  await expect(page.getByTestId('history-item-score')).toHaveText(
    'Aderencia: 88/100',
  );
  await expect(page.getByTestId('history-item-date')).toHaveAttribute(
    'datetime',
    '2026-09-01T15:04:00Z',
  );
  await expect(page.getByTestId('history-empty')).toHaveCount(0);
  expect(historyUrls.length).toBeGreaterThan(0);
});

test('2. logado + 200 [] → estado vazio claro', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({ body: { items: [] } }));
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();

  await expect(page.getByTestId('history-empty')).toContainText(
    'Nenhum retorno salvo ainda.',
  );
  await expect(page.getByTestId('history-list')).toHaveCount(0);
  await expect(page.getByTestId('history-item')).toHaveCount(0);
});

test('3. 401/403 → erro legivel e nunca dados de outro usuario', async ({
  page,
}) => {
  const otherUser = {
    id: 'other',
    job_title: 'Vaga de outra pessoa',
    company_name: 'Outra Corp',
    match_score: 99,
    created_at: '2026-01-01T00:00:00Z',
  };
  let status = 401;

  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    status,
    body: {
      detail: status === 401 ? 'Nao autenticado' : 'Forbidden',
      items: [otherUser],
    },
  }));
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();

  await expect(page.getByTestId('history-error')).toContainText(
    'Sessao expirada. Entre novamente para ver o historico.',
  );
  await expect(page.getByText('Vaga de outra pessoa')).toHaveCount(0);
  await expect(page.getByTestId('history-list')).toHaveCount(0);

  status = 403;
  await page.getByTestId('history-retry').click();
  await expect(page.getByTestId('history-error')).toContainText(
    'Nao foi possivel carregar o historico.',
  );
  await expect(page.getByText('Vaga de outra pessoa')).toHaveCount(0);
  await expect(page.getByText('Outra Corp')).toHaveCount(0);
});

test('4. 5xx/rede → erro sanitizado sem path, token ou stack', async ({
  page,
}) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    status: 500,
    body: {
      detail:
        'File "/app/main.py", line 12, in read_gap_history GET /users/me/gap-history Bearer jwt-abc',
    },
  }));
  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-historico').click();

  const error = page.getByTestId('history-error');
  await expect(error).toContainText(
    'Nao foi possivel carregar o historico. Tente novamente.',
  );
  await expect(error).not.toContainText('/users/me/gap-history');
  await expect(error).not.toContainText('onrender.com');
  await expect(error).not.toContainText('jwt-abc');
  await expect(error).not.toContainText('main.py');
  await expect(error).not.toContainText('Bearer');
});

test('5. sem JWT mostra login e nao chama a API', async ({ page }) => {
  const historyHits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/users/me/gap-history')) {
      historyHits.push(request.url());
    }
  });

  await mockLegalRoutes(page);
  await page.goto('/historico');
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  await expect(page.getByTestId('history-panel')).toHaveCount(0);
  expect(historyHits).toEqual([]);

  await mockOutdatedMe(page);
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('consent-gate')).toBeVisible();
  expect(historyHits).toEqual([]);
});
