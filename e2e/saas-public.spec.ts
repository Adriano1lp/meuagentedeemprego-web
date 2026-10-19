import { expect, test, type Page } from './fixtures';

import {
  mockAuthSuccess,
  mockBillingMe,
  mockCurrentUser,
  mockGapHistory,
  mockLegalRoutes,
  mockProcessar,
  mockedBillingFree,
  mockedHistoryItem,
  mockedStatus,
  mockUserStatus,
} from './helpers';

const stripeUrl = 'https://checkout.stripe.com/c/pay/cs_test_saas';

async function clientNavigate(page: Page, path: string) {
  await page.evaluate((next) => {
    const current = window.history.state ?? {};
    const idx = typeof current.idx === 'number' ? current.idx + 1 : 1;
    window.history.pushState({ ...current, idx, usr: null }, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function login(page: Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
}

async function installNavSpy(page: Page) {
  await page.addInitScript(() => {
    const urls: string[] = [];
    const record = (url: unknown) => {
      if (typeof url === 'string') {
        urls.push(url);
      } else if (url instanceof URL) {
        urls.push(`${url.pathname}${url.search}`);
      }
    };
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (data, unused, url) => {
      record(url);
      return push(data, unused, url);
    };
    history.replaceState = (data, unused, url) => {
      record(url);
      return replace(data, unused, url);
    };
    (window as unknown as { __maeNav: string[] }).__maeNav = urls;
  });
}

test('CTAs da landing preservam cadastro e a intencao do Essencial', async ({
  page,
}) => {
  const checkoutHits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/billing/checkout')) {
      checkoutHits.push(request.url());
    }
  });
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page, {
    user_id: 'user-1',
    display_name: 'Ada Lovelace',
    email: 'ada@example.com',
    plan: 'free',
    subscription_status: 'none',
  });
  await mockBillingMe(page, () => ({ ...mockedBillingFree }));

  await page.goto('/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
  await expect(page.getByTestId('app-bottom-nav')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Análise de vaga com o seu currículo',
  );

  await page.getByTestId('cta-comecar-gratis').click();
  await expect(page).toHaveURL(/\/entrar\?tab=signup$/);
  await expect(page.getByTestId('auth-tab-signup')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.goto('/');
  await page.getByTestId('cta-assinar-essencial').click();
  await expect(page).toHaveURL(/\/entrar\?/);
  expect(decodeURIComponent(page.url())).toContain('next=/app/perfil');
  expect(checkoutHits).toEqual([]);

  await login(page);
  await expect(page.getByTestId('profile-panel')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/perfil$/);
  await expect(page.getByTestId('subscribe-essencial')).toBeVisible();
  expect(checkoutHits).toEqual([]);
});

test('logado em / ve Ir para o app e /entrar volta para /app', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page);
  await mockBillingMe(page);

  await page.goto('/entrar');
  await login(page);
  await expect(page.getByTestId('home-shell')).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);

  await clientNavigate(page, '/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await page.getByTestId('cta-ir-para-o-app').click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId('home-shell')).toBeVisible();

  await clientNavigate(page, '/entrar');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId('home-shell')).toBeVisible();
});

test('rotas antigas e /app sem JWT voltam a origem depois do login', async ({
  page,
}) => {
  const historyHits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/users/me/gap-history')) {
      historyHits.push(request.url());
    }
  });
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockGapHistory(page, () => ({
    body: { items: [mockedHistoryItem], limit: 20, offset: 0 },
  }));
  await mockCurrentUser(page);

  await page.goto('/app/historico');
  await expect(page.getByTestId('session-expired-notice')).toBeVisible();
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();
  expect(historyHits).toEqual([]);
  await login(page);
  await expect(page).toHaveURL(/\/app\/historico$/);
  await expect(page.getByTestId('history-panel')).toBeVisible();

  await page.goto('/historico');
  await expect(page.getByTestId('session-expired-notice')).toBeVisible();
  await login(page);
  await expect(page).toHaveURL(/\/app\/historico$/);

  await page.goto('/perfil');
  await expect(page.getByTestId('session-expired-notice')).toBeVisible();
  await login(page);
  await expect(page).toHaveURL(/\/app\/perfil$/);
  await expect(page.getByTestId('profile-name')).toBeVisible();
});

test('/?billing=success encaminha para /app e a confirmacao segue no login', async ({
  page,
}) => {
  await installNavSpy(page);
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    plan: 'free',
    used: 1,
    limit: 5,
    remaining: 4,
  });
  await mockBillingMe(page, () => ({ ...mockedBillingFree }));

  await page.goto('/?billing=success&session_id=cs_test_secret');
  await expect(page.getByTestId('billing-login-notice')).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5173/entrar');
  expect(page.url()).not.toContain('session_id');
  expect(page.url()).not.toContain('cs_test');
  const nav = await page.evaluate(
    () => (window as unknown as { __maeNav: string[] }).__maeNav,
  );
  expect(
    nav.some((url) => url.includes('/app') && url.includes('billing=success')),
  ).toBe(true);

  await login(page);
  await expect(page.getByTestId('billing-confirming')).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});

test('confirmacao tambem parte de /entrar e de /app', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockBillingMe(page, () => ({ ...mockedBillingFree }));

  await page.goto('/entrar?billing=success&session_id=cs_test_entrar');
  await expect(page.getByTestId('billing-login-notice')).toBeVisible();
  await expect(page).toHaveURL(/\/entrar$/);
  expect(page.url()).not.toContain('session_id');
  await login(page);
  await expect(page.getByTestId('billing-confirming')).toBeVisible();

  await page.goto('/app?billing=cancel&session_id=cs_test_app_cancel');
  await expect(page.getByTestId('billing-login-notice')).toHaveCount(0);
  await expect(page).toHaveURL(/\/entrar$/);
  expect(page.url()).not.toContain('session_id');
  await login(page);
  await expect(page.getByTestId('billing-cancel')).toContainText(
    'Pagamento cancelado. Você continua no plano Free.',
  );
});

async function mockCheckout(page: Page) {
  const checkoutCalls: string[] = [];
  await page.route('**/billing/checkout', async (route) => {
    checkoutCalls.push(route.request().method());
    expect(route.request().postData()).toBeNull();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        checkout_url: stripeUrl,
        session_id: 'cs_test_saas',
      }),
    });
  });
  await page.route('https://checkout.stripe.com/**', async (route) => {
    await route.abort();
  });
  return checkoutCalls;
}

test('checkout do Essencial sai de /app/perfil e nao da landing', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockCurrentUser(page, {
    user_id: 'user-1',
    display_name: 'Ada Lovelace',
    email: 'ada@example.com',
    plan: 'free',
    subscription_status: 'none',
  });
  await mockBillingMe(page, () => ({ ...mockedBillingFree }));
  const checkoutCalls = await mockCheckout(page);

  await page.goto('/');
  await page.getByTestId('cta-assinar-essencial').click();
  await expect(page).toHaveURL(/\/entrar/);
  expect(checkoutCalls).toEqual([]);

  await login(page);
  await expect(page).toHaveURL(/\/app\/perfil$/);
  const navigation = page.waitForRequest((request) =>
    request.url().startsWith('https://checkout.stripe.com/'),
  );
  await page.getByTestId('subscribe-essencial').click();
  expect((await navigation).url()).toBe(stripeUrl);
  expect(checkoutCalls).toEqual(['POST']);
});

test('402 em /app inicia o checkout', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    plan: 'free',
    used: 5,
    limit: 5,
    remaining: 0,
  });
  await mockCurrentUser(page, {
    user_id: 'user-1',
    display_name: 'Ada Lovelace',
    email: 'ada@example.com',
    plan: 'free',
    subscription_status: 'none',
  });
  await mockBillingMe(page, () => ({ ...mockedBillingFree }));
  await mockProcessar(page, () => ({
    status: 402,
    body: {
      detail: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Cota gratuita do mes esgotada.',
        used: 5,
        limit: 5,
        plan: 'free',
      },
    },
  }));
  const checkoutCalls = await mockCheckout(page);

  await page.goto('/entrar');
  await login(page);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId('processar-panel')).toBeVisible();
  await page
    .getByTestId('processar-texto')
    .fill('Vaga para desenvolvedor Python com requisitos e responsabilidades.');
  await page.getByTestId('processar-submit').click();
  await expect(page.getByTestId('quota-block')).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  const second = page.waitForRequest((request) =>
    request.url().startsWith('https://checkout.stripe.com/'),
  );
  await page.getByTestId('subscribe-essencial').click();
  expect((await second).url()).toBe(stripeUrl);
  expect(checkoutCalls).toEqual(['POST']);
});
