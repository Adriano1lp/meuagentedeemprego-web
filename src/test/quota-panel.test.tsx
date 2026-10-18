import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import * as billing from '../api/billing';
import { AuthProvider } from '../auth/AuthContext';

const userBody = {
  user_id: 'user-1',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  terms_version: '1.0',
  privacy_version: '1.0',
};

const readyStatus = {
  has_cv: true,
  has_embeddings: true,
  has_profile: true,
  generated_files: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderHome(options: {
  status?: unknown;
  billing?: unknown | (() => unknown);
  billingStatus?: number;
}) {
  let billingHits = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/login')) {
      return jsonResponse({
        access_token: 'jwt-login',
        token_type: 'bearer',
        user: userBody,
      });
    }
    if (url.includes('/auth/me')) {
      return jsonResponse(userBody);
    }
    if (url.includes('/users/me/status')) {
      return jsonResponse(options.status ?? readyStatus);
    }
    if (url.includes('/billing/me')) {
      billingHits += 1;
      if (options.billingStatus) {
        return jsonResponse({ detail: 'https://api.example.test/billing/me' }, options.billingStatus);
      }
      const payload = typeof options.billing === 'function' ? options.billing() : options.billing;
      return jsonResponse(payload);
    }
    if (url.includes('/legal/')) {
      return new Response('# doc', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }
    return jsonResponse({ detail: 'ausente' }, 404);
  });

  render(
    <MemoryRouter initialEntries={['/entrar']}>
      <AuthProvider fetchImpl={fetchImpl}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

  return {
    fetchImpl,
    get billingHits() {
      return billingHits;
    },
  };
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
  await user.type(screen.getByTestId('login-password'), 'senha-segura');
  await user.click(screen.getByTestId('login-submit'));
  await screen.findByTestId('home-shell');
}

describe('painel de cota na home', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('Free mostra o plano, o uso e a data de reinicio', async () => {
    renderHome({
      billing: {
        plan: 'free',
        used: 2,
        limit: 5,
        remaining: 3,
        period_end: '2026-11-01T00:00:00Z',
      },
    });
    const user = userEvent.setup();
    await login(user);

    expect(await screen.findByTestId('status-plan')).toHaveTextContent('Free');
    expect(screen.getByTestId('status-quota')).toHaveTextContent('2 de 5 análises usadas');
    expect(screen.getByTestId('quota-reset')).toHaveTextContent(
      'Sua cota reinicia em 1º de novembro',
    );
    expect(screen.queryByTestId('quota-exhausted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-subscribe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cv-onboarding')).not.toBeInTheDocument();
    expect(screen.getByTestId('processar-panel')).toBeInTheDocument();
  });

  it('Essencial mostra 30 e, esgotado, só a frase de reinicio', async () => {
    renderHome({
      billing: {
        plan: 'essencial',
        used: 30,
        limit: 30,
        remaining: 0,
        period_end: '2027-01-01T00:00:00Z',
      },
    });
    const user = userEvent.setup();
    await login(user);

    expect(await screen.findByTestId('status-plan')).toHaveTextContent('Essencial');
    expect(screen.getByTestId('status-quota')).toHaveTextContent('30 de 30 análises usadas');
    expect(screen.getByTestId('quota-reset')).toHaveTextContent(
      'Sua cota reinicia em 1º de janeiro',
    );
    expect(screen.queryByTestId('quota-subscribe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-exhausted')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-card').textContent).not.toMatch(
      /renovação|renovacao|cobrança|cobranca|fatura/i,
    );
  });

  it('Free esgotado mostra aviso neutro e o CTA do checkout existente', async () => {
    vi.spyOn(billing, 'assignCheckoutUrl').mockImplementation(() => {});
    let checkoutBody: BodyInit | null | undefined = 'unset';
    const harness = renderHome({
      billing: {
        plan: 'free',
        used: 5,
        limit: 5,
        remaining: 0,
        period_end: '2026-11-01T00:00:00Z',
      },
    });
    harness.fetchImpl.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/billing/checkout')) {
        checkoutBody = init?.body;
        return jsonResponse({
          checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_page',
          session_id: 'cs_test_secret',
        });
      }
      if (url.includes('/auth/login')) {
        return jsonResponse({
          access_token: 'jwt-login',
          token_type: 'bearer',
          user: userBody,
        });
      }
      if (url.includes('/auth/me')) {
        return jsonResponse(userBody);
      }
      if (url.includes('/users/me/status')) {
        return jsonResponse(readyStatus);
      }
      if (url.includes('/billing/me')) {
        return jsonResponse({
          plan: 'free',
          used: 5,
          limit: 5,
          remaining: 0,
          period_end: '2026-11-01T00:00:00Z',
        });
      }
      return jsonResponse({ detail: 'ausente' }, 404);
    });

    const user = userEvent.setup();
    await login(user);
    expect(await screen.findByTestId('quota-exhausted')).toHaveTextContent(
      'As análises deste período acabaram.',
    );
    const button = screen.getByTestId('quota-subscribe');
    expect(button).toHaveTextContent('Assinar Essencial');
    await user.click(button);
    await waitFor(() => {
      expect(billing.assignCheckoutUrl).toHaveBeenCalledWith(
        'https://checkout.stripe.com/c/pay/cs_test_page',
      );
    });
    expect(checkoutBody).toBeUndefined();
  });

  it('erro de cota tem Tentar de novo e nao esconde a analise', async () => {
    let fail = true;
    const harness = renderHome({
      billingStatus: 500,
      status: readyStatus,
    });
    harness.fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/login')) {
        return jsonResponse({
          access_token: 'jwt-login',
          token_type: 'bearer',
          user: userBody,
        });
      }
      if (url.includes('/auth/me')) {
        return jsonResponse(userBody);
      }
      if (url.includes('/users/me/status')) {
        return jsonResponse(readyStatus);
      }
      if (url.includes('/billing/me')) {
        if (fail) {
          return jsonResponse({ detail: 'https://api.example.test/billing/me quebrou' }, 500);
        }
        return jsonResponse({
          plan: 'free',
          used: 1,
          limit: 5,
          remaining: 4,
          period_end: '2026-11-01T00:00:00Z',
        });
      }
      return jsonResponse({}, 404);
    });

    const user = userEvent.setup();
    await login(user);
    expect(await screen.findByTestId('quota-error')).toHaveTextContent(
      'Não foi possível carregar a cota agora.',
    );
    expect(screen.getByTestId('quota-error').textContent).not.toMatch(/https?:|\/billing|token/i);
    expect(screen.getByTestId('processar-panel')).toBeInTheDocument();
    expect(screen.getByTestId('home-shortcuts')).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByTestId('quota-retry'));
    expect(await screen.findByTestId('status-quota')).toHaveTextContent('1 de 5 análises usadas');
    expect(screen.queryByTestId('quota-error')).not.toBeInTheDocument();
  });

  it('sem period_end esconde a frase de reinicio', async () => {
    renderHome({
      billing: { plan: 'free', used: 1, limit: 5, remaining: 4 },
    });
    const user = userEvent.setup();
    await login(user);
    expect(await screen.findByTestId('status-quota')).toHaveTextContent('1 de 5 análises usadas');
    expect(screen.queryByTestId('quota-reset')).not.toBeInTheDocument();
  });

  it('sem CV mostra onboarding e bloqueia a analise', async () => {
    renderHome({
      status: { has_cv: false, has_embeddings: false, has_profile: false, generated_files: 0 },
      billing: {
        plan: 'free',
        used: 0,
        limit: 5,
        remaining: 5,
        period_end: '2026-11-01T00:00:00Z',
      },
    });
    const user = userEvent.setup();
    await login(user);
    expect(await screen.findByTestId('cv-onboarding')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar pelo formulário' })).toBeDisabled();
    expect(screen.getByTestId('cv-create-form-soon')).toHaveTextContent('em breve');
    expect(screen.getByTestId('processar-gate')).toHaveTextContent(
      'Envie um currículo para liberar a análise de vaga.',
    );
    expect(screen.getByTestId('processar-submit')).toBeDisabled();
    expect(screen.getByTestId('shortcut-analisar')).toHaveAttribute('href', '/app#analise');
    expect(screen.getByTestId('shortcut-carta')).toHaveAttribute('href', '/app/historico');
    expect(screen.getByTestId('shortcut-historico')).toHaveAttribute('href', '/app/historico');
    expect(screen.getByTestId('shortcut-perfil')).toHaveAttribute('href', '/app/perfil');
  });
});
