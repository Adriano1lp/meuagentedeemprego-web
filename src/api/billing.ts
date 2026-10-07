/**
 * Adaptador de billing (contrato confirmado, API master a536c41).
 *
 * POST /billing/checkout (sem body) → { checkout_url, session_id }.
 * GET  /billing/me → { plan, subscription_status, used, limit, period, remaining }.
 * Volta do Checkout: /?billing=success&session_id=cs_... ou /?billing=cancel.
 *
 * session_id é descartado. Não entra em estado, storage, log nem na URL depois da leitura.
 * O preço R$ 19,90 é texto de UI; este módulo não envia price_id nem valor.
 */

export const BILLING_CHECKOUT_PATH = '/billing/checkout';
export const BILLING_ME_PATH = '/billing/me';

export const CHECKOUT_URL_KEY = 'checkout_url';
/** Presente no JSON de checkout. O cliente não lê o valor para guardar. */
export const CHECKOUT_SESSION_ID_KEY = 'session_id';

export const BILLING_PLAN_KEY = 'plan';
export const BILLING_SUBSCRIPTION_STATUS_KEY = 'subscription_status';
export const BILLING_USED_KEY = 'used';
export const BILLING_LIMIT_KEY = 'limit';
export const BILLING_REMAINING_KEY = 'remaining';
export const BILLING_PERIOD_KEY = 'period';

/** Essencial ativo: o servidor já reduz past_due para plan "free". */
export const ESSENCIAL_PLAN = 'essencial';

export const STRIPE_CHECKOUT_HOST = 'checkout.stripe.com';

export const BILLING_RETURN_PARAM = 'billing';
export const BILLING_RETURN_SUCCESS = 'success';
export const BILLING_RETURN_CANCEL = 'cancel';
export const BILLING_SESSION_QUERY = 'session_id';

export const BILLING_POLL_INTERVAL_MS = 3_000;
export const BILLING_POLL_DEADLINE_MS = 60_000;

export const CHECKOUT_START_FAILED =
  'Não foi possível iniciar a assinatura agora. Tente novamente em instantes.';

export const BILLING_READ_FAILED =
  'Não foi possível confirmar a assinatura agora. Tente novamente em instantes.';

export const BILLING_SESSION_EXPIRED =
  'Sessao expirada. Entre novamente para continuar.';

export const BILLING_CONFIRMING = 'Confirmando pagamento…';

export const BILLING_TIMEOUT =
  'Recebemos seu pagamento. A confirmação pode levar alguns minutos.';

export const BILLING_LOGIN_AFTER_PAYMENT =
  'Pagamento recebido. Entre para confirmar sua assinatura.';

export const BILLING_CANCELLED =
  'Pagamento cancelado. Você continua no plano Free.';

export const BILLING_CONFIRMED = 'Assinatura confirmada.';

export const SUBSCRIBE_ESSENCIAL_LABEL = 'Assinar Essencial R$19,90/mês';

export const BILLING_REFRESH_LABEL = 'Atualizar';

export type BillingReturnIntent = 'success' | 'cancel';

export type BillingMe = {
  plan?: string;
  subscription_status?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  period?: string;
};

export type CheckoutRedirect = {
  checkoutUrl: string;
};

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function isEssencialActive(billing: {
  plan?: string | null;
}): boolean {
  return billing.plan === ESSENCIAL_PLAN;
}

/** Só https no host exato do Checkout. Qualquer outro valor é recusado. */
export function isStripeCheckoutUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  return url.hostname === STRIPE_CHECKOUT_HOST;
}

export function parseCheckoutResponse(payload: unknown): CheckoutRedirect {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('checkout');
  }
  const record = payload as Record<string, unknown>;
  const checkoutUrl = record[CHECKOUT_URL_KEY];
  if (typeof checkoutUrl !== 'string' || !isStripeCheckoutUrl(checkoutUrl)) {
    throw new Error('checkout');
  }
  return { checkoutUrl };
}

export function parseBillingMe(payload: unknown): BillingMe {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('billing');
  }
  const record = payload as Record<string, unknown>;
  return {
    plan: asOptionalString(record[BILLING_PLAN_KEY]),
    subscription_status: asOptionalString(record[BILLING_SUBSCRIPTION_STATUS_KEY]),
    used: asOptionalNumber(record[BILLING_USED_KEY]),
    limit: asOptionalNumber(record[BILLING_LIMIT_KEY]),
    remaining: asOptionalNumber(record[BILLING_REMAINING_KEY]),
    period: asOptionalString(record[BILLING_PERIOD_KEY]),
  };
}

export function readBillingReturnIntent(search: string): BillingReturnIntent | null {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const value = params.get(BILLING_RETURN_PARAM);
  if (value === BILLING_RETURN_SUCCESS) {
    return 'success';
  }
  if (value === BILLING_RETURN_CANCEL) {
    return 'cancel';
  }
  return null;
}

/** Remove billing e session_id. O valor de session_id não é copiado. */
export function searchWithoutBillingReturn(search: string): string {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  params.delete(BILLING_RETURN_PARAM);
  params.delete(BILLING_SESSION_QUERY);
  const next = params.toString();
  return next ? `?${next}` : '';
}

export function replaceBrowserUrlWithoutBillingReturn(): void {
  if (typeof window === 'undefined' || !window.location) {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(BILLING_RETURN_PARAM);
  url.searchParams.delete(BILLING_SESSION_QUERY);
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', next);
}

export function assignCheckoutUrl(url: string): void {
  if (!isStripeCheckoutUrl(url)) {
    throw new Error('checkout');
  }
  window.location.assign(url);
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { name?: string }).name === 'AbortError'
  );
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function shouldStopPolling(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { status?: unknown; outdated?: unknown };
  return record.status === 401 || Boolean(record.outdated);
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Primeira leitura na hora, depois a cada 3s, até 60s.
 * Não promove plano: só devolve 'essencial' quando a API manda plan === "essencial".
 */
export async function pollBillingUntilEssencial(
  read: (signal: AbortSignal) => Promise<BillingMe>,
  signal: AbortSignal,
  options?: {
    intervalMs?: number;
    deadlineMs?: number;
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<'essencial' | 'timeout'> {
  const intervalMs = options?.intervalMs ?? BILLING_POLL_INTERVAL_MS;
  const deadlineMs = options?.deadlineMs ?? BILLING_POLL_DEADLINE_MS;
  const now = options?.now ?? (() => Date.now());
  const sleep = options?.sleep ?? delay;
  const started = now();

  for (;;) {
    if (signal.aborted) {
      throw abortError();
    }
    if (now() - started >= deadlineMs) {
      return 'timeout';
    }

    try {
      const billing = await read(signal);
      if (isEssencialActive(billing)) {
        return 'essencial';
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        throw abortError();
      }
      if (shouldStopPolling(error)) {
        throw error;
      }
    }

    const remaining = deadlineMs - (now() - started);
    if (remaining <= 0) {
      return 'timeout';
    }
    await sleep(Math.min(intervalMs, remaining), signal);
  }
}
