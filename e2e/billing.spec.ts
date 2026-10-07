import { expect, test } from '@playwright/test';

import {
  mockAuthSuccess,
  mockBillingMe,
  mockCurrentUser,
  mockLegalRoutes,
  mockProcessar,
  mockedBillingEssencial,
  mockedBillingFree,
  mockedStatus,
  mockUserStatus,
} from './helpers';

const artifacts = '/opt/cursor/artifacts';
const stripeUrl = 'https://checkout.stripe.com/c/pay/cs_test_e2e';

const essencialStatus = {
  ...mockedStatus,
  plan: 'essencial',
  subscription_status: 'active',
  used: 5,
  limit: 30,
  remaining: 25,
  period: '2026-10',
};

async function login(page: import('@playwright/test').Page) {
  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toBeVisible();
}

test('Free vê o CTA, o POST não leva preço e o Checkout é stripe.com', async ({
  page,
}) => {
  const checkoutCalls: { body: string | null; authorization: string | undefined }[] =
    [];
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    plan: 'free',
    used: 5,
    limit: 5,
    remaining: 0,
  });
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
  await page.route('**/billing/checkout', async (route) => {
    checkoutCalls.push({
      body: route.request().postData(),
      authorization: route.request().headers().authorization,
    });
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-user-id']).toBeUndefined();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        checkout_url: stripeUrl,
        session_id: 'cs_test_e2e',
      }),
    });
  });
  await page.route('https://checkout.stripe.com/**', async (route) => {
    await route.abort();
  });

  await page.goto('/');
  await login(page);
  await expect(page.getByTestId('cv-ready')).toBeVisible();
  await page
    .getByTestId('processar-texto')
    .fill('Vaga para desenvolvedor Python com requisitos e responsabilidades.');
  await page.getByTestId('processar-submit').click();
  await expect(page.getByTestId('subscribe-essencial')).toHaveText(
    'Assinar Essencial R$19,90/mês',
  );
  await page.screenshot({
    path: `${artifacts}/billing-cta.png`,
    fullPage: true,
  });

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  expect(storage).toEqual({ local: 0, session: 0 });

  const navigation = page.waitForRequest((request) =>
    request.url().startsWith('https://checkout.stripe.com/'),
  );
  await page.getByTestId('subscribe-essencial').click();
  const request = await navigation;
  expect(request.url()).toBe(stripeUrl);
  expect(checkoutCalls).toHaveLength(1);
  expect(checkoutCalls[0].body).toBeNull();
  expect(checkoutCalls[0].authorization).toBe('Bearer jwt-login');
  expect(JSON.stringify(checkoutCalls[0])).not.toMatch(/price_id|pk_|sk_|whsec_/);
});

test('volta sem sessão pede login e só então mostra o limite 30', async ({
  page,
}) => {
  let confirmed = false;
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await page.route('**/users/me/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        confirmed
          ? essencialStatus
          : {
              ...mockedStatus,
              plan: 'free',
              used: 5,
              limit: 5,
              remaining: 0,
            },
      ),
    });
  });
  await page.route('**/billing/me', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    confirmed = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockedBillingEssencial),
    });
  });

  await page.goto('/?billing=success&session_id=cs_test_secret');
  await expect(page.getByTestId('billing-login-notice')).toHaveText(
    'Pagamento recebido. Entre para confirmar sua assinatura.',
  );
  await expect(page).toHaveURL('http://127.0.0.1:5173/');
  const href = page.url();
  expect(href).not.toContain('session_id');
  expect(href).not.toContain('cs_test');

  const storageBefore = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases?.()) ?? [],
  }));
  expect(storageBefore.local).toBe(0);
  expect(storageBefore.session).toBe(0);
  expect(storageBefore.databases).toEqual([]);

  await login(page);
  await expect(page.getByTestId('billing-confirming')).toHaveText(
    'Confirmando pagamento…',
  );
  await page.screenshot({
    path: `${artifacts}/billing-confirming.png`,
    fullPage: true,
  });
  await expect(page.getByTestId('status-quota')).toContainText('5 de 30');
  await expect(page.getByTestId('billing-confirmed')).toBeVisible();
  await expect(page.getByTestId('subscribe-essencial')).toHaveCount(0);
});

test('webhook atrasado mostra Atualizar sem erro vermelho', async ({ page }) => {
  await page.clock.install();
  await page.clock.resume();
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, {
    ...mockedStatus,
    plan: 'free',
    used: 5,
    limit: 5,
    remaining: 0,
  });
  await mockBillingMe(page, () => ({ ...mockedBillingFree }));

  await page.goto('/?billing=success&session_id=cs_test_late');
  await login(page);
  await expect(page.getByTestId('billing-confirming')).toBeVisible();
  await page.clock.pauseAt(Date.now() + 60_000);
  await expect(page.getByTestId('billing-timeout')).toContainText(
    'Recebemos seu pagamento. A confirmação pode levar alguns minutos.',
  );
  await expect(page.getByTestId('billing-refresh')).toHaveText('Atualizar');
  await expect(page.getByTestId('billing-timeout')).not.toHaveAttribute(
    'role',
    'alert',
  );
  await expect(page.getByTestId('status-quota')).toContainText('5 de 5');
  await page.screenshot({
    path: `${artifacts}/billing-timeout.png`,
    fullPage: true,
  });
});

test('cancelamento deixa o Free com aviso neutro', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockBillingMe(page, () => ({ ...mockedBillingFree }));
  await page.goto('/?billing=cancel&session_id=cs_test_cancel');
  await expect(page.getByTestId('billing-login-notice')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:5173/');
  expect(page.url()).not.toContain('session_id');

  const billingHits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/billing/me')) {
      billingHits.push(request.url());
    }
  });

  await login(page);
  await expect(page.getByTestId('billing-cancel')).toHaveText(
    'Pagamento cancelado. Você continua no plano Free.',
  );
  await expect(page.getByTestId('status-plan')).toHaveText('Free');
  await expect(page.getByTestId('status-quota')).toContainText('1 de 5');
  await page.screenshot({
    path: `${artifacts}/billing-cancel.png`,
    fullPage: true,
  });
  expect(billingHits).toEqual([]);
});

test('Essencial não vê o CTA no perfil nem no bloqueio', async ({ page }) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await mockUserStatus(page, essencialStatus);
  await mockCurrentUser(page, {
    user_id: 'user-1',
    display_name: 'Ada Lovelace',
    email: 'ada@example.com',
    plan: 'free',
    subscription_status: 'none',
  });
  await mockBillingMe(page, () => ({ ...mockedBillingEssencial }));
  await mockProcessar(page, () => ({
    status: 402,
    body: {
      detail: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Cota gratuita do mes esgotada.',
        plan: 'free',
      },
    },
  }));

  await page.goto('/');
  await login(page);
  await page.getByTestId('nav-perfil').click();
  await expect(page.getByTestId('profile-name')).toHaveText('Ada Lovelace');
  await expect(page.getByTestId('profile-plan')).toHaveText('Free');
  await expect(page.getByTestId('subscribe-essencial')).toHaveCount(0);

  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('cv-ready')).toBeVisible();
  await page
    .getByTestId('processar-texto')
    .fill('Vaga para desenvolvedor Python com requisitos e responsabilidades.');
  await page.getByTestId('processar-submit').click();
  await expect(page.getByTestId('quota-block')).toBeVisible();
  await expect(page.getByTestId('subscribe-essencial')).toHaveCount(0);
});
