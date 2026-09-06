import { describe, expect, it, vi } from 'vitest';

import { buildRegisterPayload, createApiClient } from '../api/client';
import {
  bearerHeaders,
  createMemoryTokenStore,
  extractAccessToken,
} from '../api/token';
import {
  buildRegisterConsentFields,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '../legal/versions';

describe('register payload', () => {
  it('inclui os 4 campos vigentes so com aceite explicito true', () => {
    const payload = buildRegisterPayload({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'senha-segura',
      termsAccepted: true,
      privacyAccepted: true,
    });

    expect(payload).toEqual({
      display_name: 'Ada',
      email: 'ada@example.com',
      password: 'senha-segura',
      terms_accepted: true,
      terms_version: '1.0',
      privacy_accepted: true,
      privacy_version: '1.0',
    });
    expect(CURRENT_TERMS_VERSION).toBe('1.0');
    expect(CURRENT_PRIVACY_VERSION).toBe('1.0');
    expect(
      buildRegisterConsentFields({ termsAccepted: true, privacyAccepted: true }),
    ).toEqual({
      terms_accepted: true,
      terms_version: CURRENT_TERMS_VERSION,
      privacy_accepted: true,
      privacy_version: CURRENT_PRIVACY_VERSION,
    });
  });

  it('nao assume aceite quando flags sao omitidas ou false', () => {
    const omitted = buildRegisterPayload({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'senha-segura',
    });
    expect(omitted.terms_accepted).toBe(false);
    expect(omitted.privacy_accepted).toBe(false);
    expect(omitted.terms_version).toBe('1.0');
    expect(omitted.privacy_version).toBe('1.0');

    const refused = buildRegisterPayload({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'senha-segura',
      termsAccepted: false,
      privacyAccepted: false,
    });
    expect(refused.terms_accepted).toBe(false);
    expect(refused.privacy_accepted).toBe(false);

    const partial = buildRegisterPayload({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'senha-segura',
      termsAccepted: true,
    });
    expect(partial.terms_accepted).toBe(true);
    expect(partial.privacy_accepted).toBe(false);
  });
});

describe('token handling', () => {
  it('guarda o access_token em memoria e anexa Bearer', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) {
        return new Response(
          JSON.stringify({
            access_token: 'jwt-memoria',
            token_type: 'bearer',
            user: { display_name: 'Ada', email: 'ada@example.com' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/auth/me')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBe('Bearer jwt-memoria');
        expect(headers.get('X-User-Id')).toBeNull();
        return new Response(
          JSON.stringify({ display_name: 'Ada', email: 'ada@example.com' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => store.get(),
    });

    const auth = await api.login({
      email: 'ada@example.com',
      password: 'senha-segura',
    });
    expect(extractAccessToken(auth)).toBe('jwt-memoria');
    store.set(auth.access_token);
    expect(store.get()).toBe('jwt-memoria');
    expect(bearerHeaders(store.get())).toEqual({
      Authorization: 'Bearer jwt-memoria',
    });

    await api.me();

    store.clear();
    expect(store.get()).toBeNull();
    expect(bearerHeaders(store.get())).toEqual({});
  });

  it('POST /auth/register envia o JSON com os 4 campos de consentimento', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        display_name: 'Ada',
        email: 'ada@example.com',
        password: 'senha-segura',
        terms_accepted: true,
        terms_version: '1.0',
        privacy_accepted: true,
        privacy_version: '1.0',
      });
      return new Response(
        JSON.stringify({
          access_token: 'jwt-registro',
          token_type: 'bearer',
          user: { display_name: 'Ada' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => null,
    });

    const response = await api.register({
      displayName: 'Ada',
      email: 'ada@example.com',
      password: 'senha-segura',
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(response.access_token).toBe('jwt-registro');
    expect(response.token_type).toBe('bearer');
  });

  it('POST /auth/register nao envia aceite true se a UI omitir os flags', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.terms_accepted).toBe(false);
      expect(body.privacy_accepted).toBe(false);
      return new Response(JSON.stringify({ detail: 'Consentimento invalido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const api = createApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getToken: () => null,
    });

    await expect(
      api.register({
        displayName: 'Ada',
        email: 'ada@example.com',
        password: 'senha-segura',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
