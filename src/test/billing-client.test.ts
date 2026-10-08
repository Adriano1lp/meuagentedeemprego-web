import { describe, expect, it, vi } from 'vitest';

import {
  BILLING_READ_FAILED,
  BILLING_SESSION_EXPIRED,
  CHECKOUT_START_FAILED,
} from '../api/billing';
import { ApiError, createApiClient } from '../api/client';

const stripeUrl = 'https://checkout.stripe.com/c/pay/cs_test_123';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HTTP de billing', () => {
  it('POST /billing/checkout nao envia body, price_id nem valor', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
      const headerDump = JSON.stringify([...(new Headers(init?.headers))]);
      expect(headerDump).not.toMatch(/price_id|unit_amount|pk_|sk_|whsec_|X-User-Id/i);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt-memory');
      expect(new Headers(init?.headers).get('X-User-Id')).toBeNull();
      return jsonResponse({
        checkout_url: stripeUrl,
        session_id: 'cs_test_secret',
      });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memory',
    });

    const result = await api.startCheckout();
    expect(result).toEqual({ checkoutUrl: stripeUrl });
    expect(JSON.stringify(result)).not.toContain('cs_test_secret');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.example.test/billing/checkout');
    expect(init?.body).toBeUndefined();
    expect(JSON.stringify(init)).not.toMatch(/price_id|19,90|1990|pk_|sk_|whsec_/);
  });

  it('URL fora do Checkout vira erro generico sem a URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        checkout_url: 'https://evil.example/pay',
        session_id: 'cs_test_secret',
      }),
    );
    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memory',
    });

    await expect(api.startCheckout()).rejects.toMatchObject({
      message: CHECKOUT_START_FAILED,
      body: null,
    });
  });

  it('401, 403 OUTDATED e 5xx nao vazam detalhe, path ou token', async () => {
    const cases = [
      {
        status: 401,
        body: { detail: 'token jwt-memory expirado em /billing/checkout' },
        message: BILLING_SESSION_EXPIRED,
      },
      {
        status: 404,
        body: { detail: 'rota /billing/checkout ausente' },
        message: CHECKOUT_START_FAILED,
      },
      {
        status: 500,
        body: { detail: 'stripe sk_test_nao_mostrar' },
        message: CHECKOUT_START_FAILED,
      },
      {
        status: 502,
        body: { detail: 'bad gateway https://api.example.test/billing/checkout' },
        message: CHECKOUT_START_FAILED,
      },
      {
        status: 503,
        body: { detail: 'indisponivel' },
        message: CHECKOUT_START_FAILED,
      },
    ];

    for (const item of cases) {
      const api = createApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn(async () => jsonResponse(item.body, item.status)),
        getToken: () => 'jwt-memory',
      });
      try {
        await api.startCheckout();
        throw new Error('deveria falhar');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.status).toBe(item.status);
        expect(apiError.message).toBe(item.message);
        expect(apiError.body).toBeNull();
        expect(apiError.message).not.toMatch(/billing|jwt-memory|sk_|https?:/i);
      }
    }
  });

  it('403 TERMS_OUTDATED segue o gate e GET /billing/me le o plano', async () => {
    const onOutdated = vi.fn();
    const outdated = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            detail: {
              code: 'TERMS_OUTDATED',
              message: 'Termos de uso desatualizados. Reaceite a versao vigente.',
            },
          },
          403,
        ),
      ),
      getToken: () => 'jwt-memory',
      onOutdated,
    });

    await expect(outdated.startCheckout()).rejects.toMatchObject({
      status: 403,
      outdated: { code: 'TERMS_OUTDATED' },
    });
    expect(onOutdated).toHaveBeenCalledTimes(1);

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt-memory');
      return jsonResponse({
        plan: 'essencial',
        subscription_status: 'active',
        used: 1,
        limit: 30,
        remaining: 29,
        period: '2026-10',
      });
    });
    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => 'jwt-memory',
    });
    await expect(api.getBillingMe()).resolves.toMatchObject({
      plan: 'essencial',
      limit: 30,
      remaining: 29,
    });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://api.example.test/billing/me',
    );
  });

  it('falha de GET /billing/me nao devolve path nem URL', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () =>
        jsonResponse({ detail: 'https://api.example.test/billing/me quebrou' }, 500),
      ),
      getToken: () => 'jwt-memory',
    });
    await expect(api.getBillingMe()).rejects.toMatchObject({
      status: 500,
      message: BILLING_READ_FAILED,
      body: null,
    });
  });
});
