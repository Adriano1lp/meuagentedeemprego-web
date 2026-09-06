import { expect, test } from '@playwright/test';

import { mockAuthSuccess, mockLegalRoutes, mockOutdatedMe } from './helpers';

test('signup bloqueado sem leitura/aceite e sem pre-aceite', async ({
  page,
}) => {
  await mockLegalRoutes(page);
  await page.goto('/');

  await page.getByTestId('auth-tab-signup').click();
  await expect(page.getByTestId('termsDocumentText')).toContainText(
    'Texto vigente de Termos de uso v1.0',
  );
  await expect(page.getByTestId('privacyDocumentText')).toContainText(
    'Texto vigente de Politica de privacidade v1.0',
  );

  const terms = page.getByTestId('termsAcceptCheckbox');
  const privacy = page.getByTestId('privacyAcceptCheckbox');
  const submit = page.getByTestId('createAccountButton');

  await expect(terms).not.toBeChecked();
  await expect(privacy).not.toBeChecked();
  await expect(submit).toBeDisabled();

  await page.getByTestId('signup-name').fill('Ada Lovelace');
  await page.getByTestId('signup-email').fill('ada@example.com');
  await page.getByTestId('signup-password').fill('senha-segura');
  await expect(submit).toBeDisabled();

  await terms.check();
  await expect(submit).toBeDisabled();

  await privacy.check();
  await expect(submit).toBeEnabled();
});

test('signup envia 4 campos vigentes e login com consent vigente', async ({
  page,
}) => {
  await mockLegalRoutes(page);
  await mockAuthSuccess(page);
  await page.goto('/');

  await page.getByTestId('auth-tab-signup').click();
  await expect(page.getByTestId('termsDocumentText')).toBeVisible();
  await page.getByTestId('signup-name').fill('Ada Lovelace');
  await page.getByTestId('signup-email').fill('ada@example.com');
  await page.getByTestId('signup-password').fill('senha-segura');
  await page.getByTestId('termsAcceptCheckbox').check();
  await page.getByTestId('privacyAcceptCheckbox').check();

  const registerRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/auth/register') && request.method() === 'POST',
  );
  await page.getByTestId('createAccountButton').click();
  const request = await registerRequest;
  expect(request.postDataJSON()).toMatchObject({
    display_name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'senha-segura',
    terms_accepted: true,
    terms_version: '1.0',
    privacy_accepted: true,
    privacy_version: '1.0',
  });

  await expect(page.getByTestId('home-shell')).toContainText('logado');
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('auth-tab-login')).toBeVisible();

  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-shell')).toContainText('Voce esta logado');
});

test('403 OUTDATED bloqueia o app e checkboxes nao vem pre-marcados', async ({
  page,
}) => {
  await mockLegalRoutes(page);
  await mockOutdatedMe(page);
  await page.goto('/');

  await page.getByTestId('login-email').fill('ada@example.com');
  await page.getByTestId('login-password').fill('senha-segura');
  await page.getByTestId('login-submit').click();

  await expect(page.getByTestId('consent-gate')).toBeVisible();
  await expect(page.getByTestId('consent-gate')).toContainText(
    'Documentos legais atualizados',
  );
  await expect(page.getByTestId('termsDocumentText')).toContainText(
    'Texto vigente de Termos de uso v1.0',
  );
  await expect(page.getByTestId('privacyAcceptCheckbox')).toHaveCount(0);

  const terms = page.getByTestId('termsAcceptCheckbox');
  await expect(terms).not.toBeChecked();
  await expect(page.getByTestId('reacceptConsentButton')).toBeDisabled();

  await terms.check();
  await page.getByTestId('reacceptConsentButton').click();
  await expect(page.getByTestId('home-shell')).toContainText('logado');
});
