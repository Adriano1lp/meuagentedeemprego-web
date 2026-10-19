import { test as base, expect } from '@playwright/test';

/**
 * Sem cookie de refresh, o boot não pode chamar a API real.
 * 401 mantém o comportamento dos testes que recarregam e esperam sair da sessão.
 * A rota da página, registrada depois, substitui esta.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('**/auth/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Sessao invalida' }),
      });
    });
    await context.route('**/auth/logout', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 204, body: '' });
    });
    await use(context);
  },
});

export { expect };
export type { Locator, Page } from '@playwright/test';
