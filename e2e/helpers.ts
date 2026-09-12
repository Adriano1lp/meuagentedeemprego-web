import type { Page } from '@playwright/test';

const TERMS_MD = '# Termos de Uso\n\nTexto vigente de Termos de uso v1.0';
const PRIVACY_MD =
  '# Politica de Privacidade\n\nTexto vigente de Politica de privacidade v1.0';

export const mockedUser = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

export const mockedStatus = {
  user_id: 'user-1',
  has_cv: true,
  has_profile: true,
  has_embeddings: true,
  generated_files: 1,
  plan: 'free',
  used: 1,
  limit: 5,
  remaining: 4,
  period: '2026-09',
  subscription_status: 'none',
};

export const mockedPdfUrl =
  'https://meu-agente-de-emprego.onrender.com/users/me/files/abc-123.pdf';

export const mockedPdfBytes = '%PDF-1.4\n%MAE-e2e\n';

export async function mockLegalRoutes(page: Page): Promise<void> {
  await page.route('**/legal/terms**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      body: TERMS_MD,
    });
  });
  await page.route('**/legal/privacy**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      body: PRIVACY_MD,
    });
  });
}

export async function mockAuthSuccess(page: Page): Promise<void> {
  await page.route('**/auth/register', async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    if (
      payload.terms_accepted !== true ||
      payload.privacy_accepted !== true ||
      payload.terms_version !== '1.0' ||
      payload.privacy_version !== '1.0'
    ) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Consentimento invalido' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'jwt-signup',
        token_type: 'bearer',
        user: mockedUser,
      }),
    });
  });

  await page.route('**/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'jwt-login',
        token_type: 'bearer',
        user: mockedUser,
      }),
    });
  });

  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockedUser),
    });
  });

  await mockUserStatus(page, mockedStatus);
}

export async function mockUserStatus(
  page: Page,
  body: Record<string, unknown> | (() => Record<string, unknown>),
): Promise<void> {
  await page.route('**/users/me/status', async (route) => {
    const payload = typeof body === 'function' ? body() : body;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

export async function mockProcessar(
  page: Page,
  handler: (texto: string) => {
    status?: number;
    body: unknown;
  },
): Promise<void> {
  await page.route('**/processar', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const payload = (route.request().postDataJSON() ?? {}) as { texto?: string };
    const result = handler(payload.texto ?? '');
    await route.fulfill({
      status: result.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(result.body),
    });
  });
}

export async function mockUserFile(
  page: Page,
  options: { body?: string; contentType?: string } = {},
): Promise<void> {
  await page.route('**/users/me/files/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: options.contentType ?? 'application/pdf',
      body: options.body ?? mockedPdfBytes,
    });
  });
}

export async function mockOutdatedMe(page: Page): Promise<void> {
  let accepted = false;
  await page.route('**/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'jwt-outdated',
        token_type: 'bearer',
        user: { ...mockedUser, terms_version: '0.9' },
      }),
    });
  });
  await page.route('**/auth/me', async (route) => {
    if (!accepted) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: {
            code: 'TERMS_OUTDATED',
            message: 'Termos de uso desatualizados. Reaceite a versao vigente.',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockedUser),
    });
  });
  await page.route('**/consent', async (route) => {
    accepted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await mockUserStatus(page, mockedStatus);
}
