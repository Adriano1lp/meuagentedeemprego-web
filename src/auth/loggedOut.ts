/**
 * Flag booleana de "saiu". Só o valor `1` — nunca token, e-mail ou usuário.
 * O reenvio do logout não apaga a flag. Só um login ou cadastro explícito
 * com sucesso chama `clearLoggedOutFlag`.
 * O reenvio do boot e do evento online espera um intervalo que dobra até um
 * teto. Não há loop: sem um novo boot ou online, nada é agendado de novo.
 * O clique em Sair não entra nesse intervalo.
 * Com o localStorage bloqueado, o logout fica na memória desta aba. O
 * evento online reenvia o POST no mesmo backoff. Um login novo zera a
 * memória e não reenvia.
 */

import { requestLogout } from '../api/sessionHttp';
import { REFRESH_LOCK_NAME, SESSION_CHANNEL_NAME } from './sessionRefresh';

export const LOGGED_OUT_KEY = 'mae.loggedOut';
export const LOGGED_OUT_VALUE = '1';

/** Primeira espera depois de uma falha. As seguintes dobram até o teto. */
export const LOGOUT_RETRY_BASE_MS = 1_000;
export const LOGOUT_RETRY_MAX_MS = 30_000;

const RETRY_TTL_MS = 5_000;

/** Logout desta aba quando o storage não guarda a flag. */
let memoryLoggedOut = false;

let inflight: Promise<void> | null = null;
let peerRetryAt: number | null = null;
let lastSentId: string | null = null;
let channel: BroadcastChannel | null = null;
let failures = 0;
let notBefore = 0;
let deferred: Promise<void> | null = null;
let deferredTimer: ReturnType<typeof setTimeout> | null = null;
let deferredResolve: (() => void) | null = null;

export function isLoggedOutFlag(): boolean {
  try {
    return window.localStorage.getItem(LOGGED_OUT_KEY) === LOGGED_OUT_VALUE;
  } catch {
    return memoryLoggedOut;
  }
}

/** Todo logout, com ou sem rede. Síncrono, antes do POST. */
export function markLoggedOut(): void {
  memoryLoggedOut = true;
  try {
    window.localStorage.setItem(LOGGED_OUT_KEY, LOGGED_OUT_VALUE);
  } catch {
    // Storage bloqueado: a memória da aba segura o reenvio.
  }
}

/** Só depois de login ou cadastro explícito bem-sucedido. */
export function clearLoggedOutFlag(): void {
  memoryLoggedOut = false;
  failures = 0;
  notBefore = 0;
  cancelDeferred();
  try {
    window.localStorage.removeItem(LOGGED_OUT_KEY);
  } catch {
    // Sem storage, a memória já foi limpa.
  }
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

async function drainPeer(): Promise<void> {
  if (isJsdom()) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
}

function peerFresh(): boolean {
  return peerRetryAt != null && Date.now() - peerRetryAt <= RETRY_TTL_MS;
}

function ensureChannel(): BroadcastChannel | null {
  if (channel) {
    return channel;
  }
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  try {
    channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
    channel.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { v?: number; type?: string; at?: number; id?: string } | null;
      if (!data || data.v !== 1 || data.type !== 'logout-retry') {
        return;
      }
      if (data.id && data.id === lastSentId) {
        return;
      }
      if (typeof data.at === 'number') {
        peerRetryAt = data.at;
      }
    });
    return channel;
  } catch {
    channel = null;
    return null;
  }
}

function publishRetry(at: number): void {
  const id = `${at}-${Math.random().toString(16).slice(2)}`;
  lastSentId = id;
  try {
    ensureChannel()?.postMessage({ v: 1, type: 'logout-retry', at, id });
  } catch {
    // Sem canal, cada aba segue o lock ou o próprio POST.
  }
}

/** Espera depois de `failures` respostas ruins. 1 → base, 2 → o dobro, até o teto. */
export function logoutRetryDelay(failuresCount: number): number {
  const exponent = Math.min(Math.max(failuresCount, 1) - 1, 20);
  return Math.min(LOGOUT_RETRY_MAX_MS, LOGOUT_RETRY_BASE_MS * 2 ** exponent);
}

async function logoutAccepted(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  let ok = false;
  const wrapped: typeof fetch = async (input, init) => {
    const response = await fetchImpl(input, init);
    ok = response.ok;
    return response;
  };
  await requestLogout(apiBaseUrl, wrapped);
  return ok;
}

async function sendOnce(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
  force: boolean,
): Promise<boolean> {
  const locks =
    typeof navigator !== 'undefined' && navigator.locks != null ? navigator.locks : null;
  const deliver = async (): Promise<boolean> => {
    if (peerFresh()) {
      return true;
    }
    if (!force && !isLoggedOutFlag()) {
      return true;
    }
    const ok = await logoutAccepted(apiBaseUrl, fetchImpl);
    publishRetry(Date.now());
    return ok;
  };
  if (locks) {
    let ok = true;
    await locks.request(REFRESH_LOCK_NAME, async () => {
      ensureChannel();
      await drainPeer();
      ok = await deliver();
    });
    return ok;
  }
  ensureChannel();
  await Promise.resolve();
  return deliver();
}

function noteAttempt(ok: boolean): void {
  if (!isLoggedOutFlag() || ok) {
    failures = 0;
    notBefore = 0;
    return;
  }
  failures += 1;
  notBefore = Date.now() + logoutRetryDelay(failures);
}

function startAttempt(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<void> {
  const run = sendOnce(apiBaseUrl, fetchImpl, false).then((ok) => {
    noteAttempt(ok);
  });
  inflight = run.finally(() => {
    inflight = null;
  });
  return inflight;
}

function cancelDeferred(): void {
  if (deferredTimer != null) {
    clearTimeout(deferredTimer);
    deferredTimer = null;
  }
  const resolve = deferredResolve;
  deferredResolve = null;
  deferred = null;
  resolve?.();
}

function deferAttempt(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
  delay: number,
): Promise<void> {
  if (deferred) {
    return deferred;
  }
  deferred = new Promise((resolve) => {
    deferredResolve = () => {
      deferredResolve = null;
      resolve();
    };
    deferredTimer = setTimeout(() => {
      deferredTimer = null;
      deferred = null;
      deferredResolve = null;
      if (!isLoggedOutFlag()) {
        resolve();
        return;
      }
      resolve(startAttempt(apiBaseUrl, fetchImpl));
    }, delay);
  });
  return deferred;
}

/**
 * Reenvia `POST /auth/logout` (credentials + X-MAE-CSRF) uma vez por aba
 * enquanto a chamada está em curso. O status da resposta não remove a flag.
 * `force` é o clique em Sair: o POST sai mesmo sem a flag (storage bloqueado).
 */
export function retryLoggedOut(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
  force = false,
): Promise<void> {
  if (force) {
    cancelDeferred();
    if (inflight) {
      return inflight;
    }
    const run = sendOnce(apiBaseUrl, fetchImpl, true).then(() => {
      // O clique em Sair não entra no backoff.
    });
    inflight = run.finally(() => {
      inflight = null;
    });
    return inflight;
  }
  if (!isLoggedOutFlag()) {
    return Promise.resolve();
  }
  if (inflight) {
    return inflight;
  }
  const wait = notBefore - Date.now();
  if (wait > 0) {
    return deferAttempt(apiBaseUrl, fetchImpl, wait);
  }
  return startAttempt(apiBaseUrl, fetchImpl);
}

export function resetLoggedOutForTests(): void {
  memoryLoggedOut = false;
  inflight = null;
  peerRetryAt = null;
  lastSentId = null;
  failures = 0;
  notBefore = 0;
  cancelDeferred();
  try {
    channel?.close();
  } catch {
    // Canal já fechado.
  }
  channel = null;
  try {
    window.localStorage.removeItem(LOGGED_OUT_KEY);
  } catch {
    // jsdom sem storage.
  }
}
