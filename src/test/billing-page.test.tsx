import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import * as billing from '../api/billing';
import {
  BILLING_CANCELLED,
  BILLING_CONFIRMING,
  BILLING_LOGIN_AFTER_PAYMENT,
  BILLING_POLL_INTERVAL_MS,
  BILLING_TIMEOUT,
  CHECKOUT_START_FAILED,
  SUBSCRIBE_ESSENCIAL_LABEL,
} from '../api/billing';
import { AuthProvider } from '../auth/AuthContext';
import { resetBillingReturnMemory } from '../billing/BillingReturn';

const stripeUrl = 'https://checkout.stripe.com/c/pay/cs_test_page';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

const freeStatus = {
  user_id: 'user-1',
  has_cv: true,
  has_profile: true,
  has_embeddings: true,
  generated_files: 1,
  plan: 'free',
  used: 5,
  limit: 5,
  remaining: 0,
  period: '2026-10',
  subscription_status: 'none',
};

const essencialStatus = {
  ...freeStatus,
  plan: 'essencial',
  subscription_status: 'active',
  used: 5,
  limit: 30,
  remaining: 25,
};

const freeBilling = {
  plan: 'free',
  subscription_status: 'none',
  used: 5,
  limit: 5,
  remaining: 0,
  period: '2026-10',
};

const essencialBilling = {
  plan: 'essencial',
  subscription_status: 'active',
  used: 5,
  limit: 30,
  remaining: 25,
  period: '2026-10',
};

const currentUserFree = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  plan: 'free',
  subscription_status: 'none',
};

const currentUserEssencial = {
  ...currentUserFree,
  plan: 'essencial',
  subscription_status: 'active',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type CheckoutCall = {
  url: string;
  method: string;
  body: BodyInit | null | undefined;
  authorization: string | null;
  userId: string | null;
};

type Harness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  checkoutCalls: CheckoutCall[];
  billingMeCalls: number;
  statusCalls: number;
};

function createHarness(options: {
  status?: () => unknown;
  billingMe?: () => unknown;
  checkout?: () => Response | Promise<Response>;
  processar?: () => Response;
  me?: () => Response;
  currentUser?: unknown;
} = {}): Harness {
  const checkoutCalls: CheckoutCall[] = [];
  const counters = { billingMeCalls: 0, statusCalls: 0 };

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (headers.get('X-User-Id') || headers.get('x-user-id')) {
      throw new Error('X-User-Id nao deve ser enviado');
    }
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.includes('/auth/login')) {
      return jsonResponse({
        access_token: 'jwt-login',
        token_type: 'bearer',
        user: userBody,
      });
    }
    if (url.includes('/auth/me')) {
      return options.me?.() ?? jsonResponse(userBody);
    }
    if (url.includes('/billing/checkout')) {
      checkoutCalls.push({
        url,
        method,
        body: init?.body,
        authorization: headers.get('Authorization'),
        userId: headers.get('X-User-Id'),
      });
      return (
        (await options.checkout?.()) ??
        jsonResponse({
          checkout_url: stripeUrl,
          session_id: 'cs_test_secret',
        })
      );
    }
    if (url.includes('/billing/me')) {
      counters.billingMeCalls += 1;
      return jsonResponse(options.billingMe?.() ?? freeBilling);
    }
    if (url.includes('/users/me/status')) {
      counters.statusCalls += 1;
      return jsonResponse(options.status?.() ?? freeStatus);
    }
    if (url.endsWith('/processar')) {
      return (
        options.processar?.() ??
        jsonResponse(
          {
            detail: {
              code: 'SUBSCRIPTION_REQUIRED',
              message: 'Cota gratuita do mes esgotada.',
              used: 5,
              limit: 5,
              plan: 'free',
            },
          },
          402,
        )
      );
    }
    const path = new URL(url, 'http://local').pathname;
    if (path.endsWith('/users/me')) {
      return jsonResponse(options.currentUser ?? currentUserFree);
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });

  return {
    fetchImpl,
    checkoutCalls,
    get billingMeCalls() {
      return counters.billingMeCalls;
    },
    get statusCalls() {
      return counters.statusCalls;
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-full">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderApp(fetchImpl: Harness['fetchImpl'], initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider fetchImpl={fetchImpl}>
        <LocationProbe />
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await waitFor(() => {
    expect(screen.getByTestId('home-shell')).toBeInTheDocument();
  });
}

async function analyzeUntilQuota(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByTestId('cv-ready')).toBeInTheDocument();
  });
  await user.type(
    screen.getByTestId('processar-texto'),
    'Vaga para desenvolvedor Python com requisitos e responsabilidades.',
  );
  await user.click(screen.getByTestId('processar-submit'));
  await waitFor(() => {
    expect(screen.getByTestId('quota-block')).toBeInTheDocument();
  });
}

function expectNoBillingPersistence() {
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  const dump = `${window.localStorage} ${window.sessionStorage} ${window.location.href}`;
  expect(dump).not.toMatch(/cs_test|session_id|jwt-login|access_token/);
}

describe('W3a assinatura Essencial', () => {
  beforeEach(() => {
    resetBillingReturnMemory();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(billing, 'assignCheckoutUrl').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    resetBillingReturnMemory();
    window.history.replaceState(null, '', '/');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('1. Free com 402 SUBSCRIPTION_REQUIRED assina e redireciona ao Checkout', async () => {
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await analyzeUntilQuota(user);

    const button = screen.getByTestId('subscribe-essencial');
    expect(button).toHaveTextContent(SUBSCRIBE_ESSENCIAL_LABEL);
    expect(button).toHaveTextContent('R$19,90');

    await user.click(button);

    await waitFor(() => {
      expect(harness.checkoutCalls).toHaveLength(1);
    });
    const call = harness.checkoutCalls[0];
    expect(call.method).toBe('POST');
    expect(call.body).toBeUndefined();
    expect(call.authorization).toBe('Bearer jwt-login');
    expect(call.userId).toBeNull();
    expect(call.url).toContain('/billing/checkout');
    expect(JSON.stringify(call)).not.toMatch(/price_id|unit_amount|pk_|sk_|whsec_|19,90/);
    expect(billing.assignCheckoutUrl).toHaveBeenCalledTimes(1);
    expect(billing.assignCheckoutUrl).toHaveBeenCalledWith(stripeUrl);
    expectNoBillingPersistence();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('1b. URL que nao é o Checkout vira erro generico e nao redireciona', async () => {
    const harness = createHarness({
      checkout: () =>
        jsonResponse({
          checkout_url: 'http://checkout.stripe.com/c/pay/cs_test_secret',
          session_id: 'cs_test_secret',
        }),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await analyzeUntilQuota(user);
    await user.click(screen.getByTestId('subscribe-essencial'));

    await waitFor(() => {
      expect(screen.getByTestId('subscribe-error')).toHaveTextContent(
        CHECKOUT_START_FAILED,
      );
    });
    expect(billing.assignCheckoutUrl).not.toHaveBeenCalled();
    const error = screen.getByTestId('subscribe-error').textContent ?? '';
    expect(error).not.toMatch(/checkout\.stripe|cs_test|\/billing|jwt-login|http/);
    expectNoBillingPersistence();
  });

  it('1c. o botao fica desabilitado enquanto o POST nao volta', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      checkout: () => gate,
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await analyzeUntilQuota(user);

    const button = screen.getByTestId('subscribe-essencial');
    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    await user.click(button);
    expect(harness.checkoutCalls).toHaveLength(1);

    release(
      jsonResponse({
        checkout_url: stripeUrl,
        session_id: 'cs_test_secret',
      }),
    );
    await waitFor(() => {
      expect(billing.assignCheckoutUrl).toHaveBeenCalledWith(stripeUrl);
    });
    expect(harness.checkoutCalls).toHaveLength(1);
  });

  it('2. volta sem JWT pede login e so então confirma o limite 30', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.replaceState(
      null,
      '',
      '/?billing=success&session_id=cs_test_secret',
    );
    const replaceState = vi.spyOn(window.history, 'replaceState');

    let essencial = false;
    let billingReads = 0;
    const harness = createHarness({
      billingMe: () => {
        billingReads += 1;
        if (billingReads >= 2) {
          essencial = true;
          return essencialBilling;
        }
        return freeBilling;
      },
      status: () => (essencial ? essencialStatus : freeStatus),
    });

    renderApp(harness.fetchImpl, '/?billing=success&session_id=cs_test_secret');

    expect(screen.getByTestId('billing-login-notice')).toHaveTextContent(
      BILLING_LOGIN_AFTER_PAYMENT,
    );
    expect(screen.getByTestId('billing-login-notice')).toHaveAttribute('role', 'status');
    await waitFor(() => {
      expect(screen.getByTestId('location-full')).toHaveTextContent('/');
      expect(screen.getByTestId('location-full').textContent).not.toContain('billing');
      expect(screen.getByTestId('location-full').textContent).not.toContain('session_id');
    });
    expect(window.location.href).not.toContain('session_id');
    expect(window.location.href).not.toContain('cs_test_secret');
    expect(replaceState).toHaveBeenCalled();
    expect(harness.billingMeCalls).toBe(0);
    expectNoBillingPersistence();

    await login(user);

    expect(screen.queryByTestId('billing-login-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('billing-confirming')).toHaveTextContent(BILLING_CONFIRMING);
    await waitFor(() => {
      expect(billingReads).toBe(1);
    });
    expect(screen.getByTestId('status-quota')).toHaveTextContent('5 de 5 analises usadas');

    await vi.advanceTimersByTimeAsync(BILLING_POLL_INTERVAL_MS);
    await waitFor(() => {
      expect(screen.getByTestId('billing-confirmed')).toBeInTheDocument();
    });
    expect(billingReads).toBe(2);
    expect(screen.getByTestId('status-plan')).toHaveTextContent('Essencial');
    expect(screen.getByTestId('status-quota')).toHaveTextContent('5 de 30 analises usadas');
    expect(screen.queryByTestId('subscribe-essencial')).not.toBeInTheDocument();
    expectNoBillingPersistence();

    await vi.advanceTimersByTimeAsync(BILLING_POLL_INTERVAL_MS);
    expect(billingReads).toBe(2);
  });

  it('3. webhook atrasado mostra espera com Atualizar, sem erro e sem liberar cota', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const harness = createHarness({
      billingMe: () => freeBilling,
      status: () => freeStatus,
    });
    renderApp(harness.fetchImpl, '/?billing=success&session_id=cs_test_late');
    await login(user);
    await waitFor(() => {
      expect(screen.getByTestId('billing-confirming')).toBeInTheDocument();
    });
    const readsBeforeDeadline = harness.billingMeCalls;
    expect(readsBeforeDeadline).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(screen.getByTestId('billing-confirming')).toBeInTheDocument();
    expect(screen.queryByTestId('billing-timeout')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-quota')).toHaveTextContent('5 de 5 analises usadas');

    await vi.advanceTimersByTimeAsync(15_000);
    await waitFor(() => {
      expect(screen.getByTestId('billing-timeout')).toHaveTextContent(BILLING_TIMEOUT);
    });
    const timeout = screen.getByTestId('billing-timeout');
    expect(timeout).toHaveAttribute('role', 'status');
    expect(timeout).not.toHaveAttribute('role', 'alert');
    expect(timeout.textContent?.toLowerCase()).not.toMatch(/erro/);
    expect(screen.queryByTestId('subscribe-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-quota')).toHaveTextContent('5 de 5 analises usadas');
    expect(screen.getByTestId('status-plan')).toHaveTextContent('Free');

    const readsAtTimeout = harness.billingMeCalls;
    await user.click(screen.getByTestId('billing-refresh'));
    await waitFor(() => {
      expect(screen.getByTestId('billing-confirming')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(harness.billingMeCalls).toBeGreaterThan(readsAtTimeout);
    });
    expect(screen.getByTestId('status-quota')).toHaveTextContent('5 de 5 analises usadas');
    expectNoBillingPersistence();
  });

  it('4. cancelamento continua Free, com aviso neutro e sem erro', async () => {
    window.history.replaceState(null, '', '/?billing=cancel&session_id=cs_test_cancel');
    const harness = createHarness({});
    const user = userEvent.setup();
    renderApp(harness.fetchImpl, '/?billing=cancel&session_id=cs_test_cancel');

    expect(screen.queryByTestId('billing-login-notice')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location-full').textContent).not.toContain('billing');
      expect(screen.getByTestId('location-full').textContent).not.toContain('session_id');
    });
    expect(window.location.href).not.toContain('cs_test_cancel');

    await login(user);
    expect(screen.getByTestId('billing-cancel')).toHaveTextContent(BILLING_CANCELLED);
    expect(screen.getByTestId('billing-cancel')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-plan')).toHaveTextContent('Free');
    expect(screen.getByTestId('status-quota')).toHaveTextContent('5 de 5 analises usadas');
    expect(harness.billingMeCalls).toBe(0);
    expectNoBillingPersistence();
  });

  it('5. Essencial nao vê o CTA no Perfil nem no bloqueio', async () => {
    const harness = createHarness({
      status: () => essencialStatus,
      billingMe: () => essencialBilling,
      currentUser: currentUserFree,
      processar: () =>
        jsonResponse(
          {
            detail: {
              code: 'SUBSCRIPTION_REQUIRED',
              message: 'Cota gratuita do mes esgotada.',
              plan: 'free',
            },
          },
          402,
        ),
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);

    await user.click(screen.getByTestId('nav-perfil'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(harness.billingMeCalls).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('subscribe-essencial')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-plan')).toHaveTextContent('Free');

    await user.click(screen.getByTestId('nav-home'));
    await analyzeUntilQuota(user);
    expect(screen.queryByTestId('subscribe-essencial')).not.toBeInTheDocument();
    expect(screen.getByTestId('quota-block')).toBeInTheDocument();
  });

  it('5b. perfil Free mostra o CTA e o clique nao manda preco', async () => {
    const harness = createHarness({
      billingMe: () => freeBilling,
      currentUser: currentUserEssencial,
    });
    const user = userEvent.setup();
    renderApp(harness.fetchImpl);
    await login(user);
    await user.click(screen.getByTestId('nav-perfil'));

    const button = await screen.findByTestId('subscribe-essencial');
    expect(button).toHaveTextContent('R$19,90');
    expect(screen.getByTestId('profile-plan')).toHaveTextContent('Essencial');
    await user.click(button);
    await waitFor(() => {
      expect(harness.checkoutCalls).toHaveLength(1);
    });
    expect(harness.checkoutCalls[0].body).toBeUndefined();
    expect(JSON.stringify(harness.checkoutCalls[0])).not.toMatch(
      /price_id|pk_|sk_|whsec_/,
    );
    expect(billing.assignCheckoutUrl).toHaveBeenCalledWith(stripeUrl);
  });

  it('6. 401 no checkout volta ao login e 403 OUTDATED abre o gate', async () => {
    const unauth = createHarness({
      checkout: () => jsonResponse({ detail: 'jwt-login em /billing/checkout' }, 401),
    });
    const user = userEvent.setup();
    renderApp(unauth.fetchImpl);
    await login(user);
    await analyzeUntilQuota(user);
    await user.click(screen.getByTestId('subscribe-essencial'));
    await waitFor(() => {
      expect(screen.getByTestId('auth-tab-login')).toBeInTheDocument();
    });
    expect(screen.queryByText(/jwt-login/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/billing/)).not.toBeInTheDocument();
    expectNoBillingPersistence();

    cleanup();
    resetBillingReturnMemory();

    const outdated = createHarness({
      checkout: () =>
        jsonResponse(
          {
            detail: {
              code: 'PRIVACY_OUTDATED',
              message: 'Politica de privacidade desatualizada.',
            },
          },
          403,
        ),
    });
    renderApp(outdated.fetchImpl);
    await login(user);
    await analyzeUntilQuota(user);
    await user.click(screen.getByTestId('subscribe-essencial'));
    await waitFor(() => {
      expect(screen.getByTestId('consent-gate')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('subscribe-error')).not.toBeInTheDocument();
  });

  it('parar o polling ao sair da rota', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const harness = createHarness({
      billingMe: () => freeBilling,
    });
    renderApp(harness.fetchImpl, '/?billing=success');
    await login(user);
    await waitFor(() => {
      expect(harness.billingMeCalls).toBeGreaterThan(0);
    });
    const reads = harness.billingMeCalls;
    await user.click(screen.getByTestId('nav-historico'));
    await waitFor(() => {
      expect(screen.getByTestId('history-page')).toBeInTheDocument();
    });
    await vi.advanceTimersByTimeAsync(BILLING_POLL_INTERVAL_MS * 4);
    expect(harness.billingMeCalls).toBe(reads);
  });
});
