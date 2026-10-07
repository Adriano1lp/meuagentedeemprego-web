import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BILLING_CANCELLED,
  BILLING_CONFIRMED,
  BILLING_CONFIRMING,
  BILLING_LIMIT_KEY,
  BILLING_LOGIN_AFTER_PAYMENT,
  BILLING_PERIOD_KEY,
  BILLING_PLAN_KEY,
  BILLING_POLL_DEADLINE_MS,
  BILLING_POLL_INTERVAL_MS,
  BILLING_READ_FAILED,
  BILLING_REFRESH_LABEL,
  BILLING_REMAINING_KEY,
  BILLING_RETURN_CANCEL,
  BILLING_RETURN_PARAM,
  BILLING_RETURN_SUCCESS,
  BILLING_SESSION_QUERY,
  BILLING_SUBSCRIPTION_STATUS_KEY,
  BILLING_TIMEOUT,
  BILLING_USED_KEY,
  CHECKOUT_START_FAILED,
  CHECKOUT_URL_KEY,
  isEssencialActive,
  isStripeCheckoutUrl,
  parseBillingMe,
  parseCheckoutResponse,
  readBillingReturnIntent,
  searchWithoutBillingReturn,
  SUBSCRIBE_ESSENCIAL_LABEL,
} from '../api/billing';

const stripeUrl = 'https://checkout.stripe.com/c/pay/cs_test_123';

describe('adaptador de billing', () => {
  it('aceita só https em checkout.stripe.com', () => {
    expect(isStripeCheckoutUrl(stripeUrl)).toBe(true);
    expect(
      isStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_123?foo=1'),
    ).toBe(true);
    expect(isStripeCheckoutUrl('http://checkout.stripe.com/c/pay/cs_test')).toBe(
      false,
    );
    expect(isStripeCheckoutUrl('https://checkout.stripe.com.evil.com/pay')).toBe(
      false,
    );
    expect(isStripeCheckoutUrl('https://evil.example/checkout.stripe.com')).toBe(
      false,
    );
    expect(isStripeCheckoutUrl('https://stripe.com/pay')).toBe(false);
    expect(isStripeCheckoutUrl('javascript:alert(1)')).toBe(false);
    expect(
      isStripeCheckoutUrl('https://user:pass@checkout.stripe.com/pay'),
    ).toBe(false);
  });

  it('le checkout_url e descarta session_id', () => {
    const parsed = parseCheckoutResponse({
      [CHECKOUT_URL_KEY]: stripeUrl,
      session_id: 'cs_test_secret',
    });
    expect(parsed).toEqual({ checkoutUrl: stripeUrl });
    expect(Object.keys(parsed)).toEqual(['checkoutUrl']);
    expect(JSON.stringify(parsed)).not.toContain('cs_test_secret');
    expect(() =>
      parseCheckoutResponse({ checkout_url: 'https://example.com/pay' }),
    ).toThrow();
    expect(() => parseCheckoutResponse({ session_id: 'cs_only' })).toThrow();
  });

  it('Essencial ativo é plan === essencial; past_due volta free', () => {
    expect(isEssencialActive({ plan: 'essencial' })).toBe(true);
    expect(
      isEssencialActive({ plan: 'free', subscription_status: 'past_due' } as {
        plan: string;
      }),
    ).toBe(false);
    expect(isEssencialActive({ plan: 'free' })).toBe(false);
    expect(isEssencialActive({ plan: 'Essencial' })).toBe(false);
    expect(isEssencialActive({})).toBe(false);

    const billing = parseBillingMe({
      [BILLING_PLAN_KEY]: 'essencial',
      [BILLING_SUBSCRIPTION_STATUS_KEY]: 'active',
      [BILLING_USED_KEY]: 2,
      [BILLING_LIMIT_KEY]: 30,
      [BILLING_REMAINING_KEY]: 28,
      [BILLING_PERIOD_KEY]: '2026-10',
      session_id: 'cs_nao_entra',
      price_id: 'price_nao_entra',
    });
    expect(billing).toEqual({
      plan: 'essencial',
      subscription_status: 'active',
      used: 2,
      limit: 30,
      remaining: 28,
      period: '2026-10',
    });
    expect(JSON.stringify(billing)).not.toContain('price_id');
    expect(JSON.stringify(billing)).not.toContain('cs_nao');
  });

  it('le a volta e apaga billing e session_id sem copiar o id', () => {
    expect(
      readBillingReturnIntent('?billing=success&session_id=cs_test_secret'),
    ).toBe('success');
    expect(readBillingReturnIntent(`?${BILLING_RETURN_PARAM}=${BILLING_RETURN_CANCEL}`)).toBe(
      'cancel',
    );
    expect(readBillingReturnIntent('?billing=nope')).toBeNull();
    expect(
      searchWithoutBillingReturn(
        `?${BILLING_RETURN_PARAM}=${BILLING_RETURN_SUCCESS}&${BILLING_SESSION_QUERY}=cs_test_secret&keep=1`,
      ),
    ).toBe('?keep=1');
    expect(
      searchWithoutBillingReturn('?billing=cancel&session_id=cs_test_secret'),
    ).toBe('');
  });

  it('o preco fica só no rótulo e o relógio é 3s/60s', () => {
    expect(SUBSCRIBE_ESSENCIAL_LABEL).toContain('R$19,90');
    expect(BILLING_POLL_INTERVAL_MS).toBe(3000);
    expect(BILLING_POLL_DEADLINE_MS).toBe(60000);
    expect(CHECKOUT_START_FAILED).not.toMatch(/https?:|\/billing|price_id|pk_|sk_|whsec_/);
    expect(BILLING_READ_FAILED).not.toMatch(/https?:|\/billing|price_id/);
    expect(BILLING_CONFIRMING).toBe('Confirmando pagamento…');
    expect(BILLING_TIMEOUT).toContain('Recebemos seu pagamento');
    expect(BILLING_REFRESH_LABEL).toBe('Atualizar');
    expect(BILLING_LOGIN_AFTER_PAYMENT).toContain('Entre para confirmar');
    expect(BILLING_CANCELLED).not.toMatch(/erro/i);
    expect(BILLING_CONFIRMED.length).toBeGreaterThan(0);
  });

  it('o codigo de producao nao tem chave Stripe', () => {
    const root = join(process.cwd(), 'src');
    const files = listSourceFiles(root).filter((file) => !file.includes(`${join('src', 'test')}`));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/pk_live|pk_test|sk_live|sk_test|whsec_/);
      expect(text, file).not.toMatch(/console\.(log|info|debug|warn)\(/);
    }
  });
});

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      files.push(path);
    }
  }
  return files;
}
