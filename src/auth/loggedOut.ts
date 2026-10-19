/**
 * Flag booleana de "saiu". Só o valor `1` — nunca token, e-mail ou usuário.
 * O reenvio do logout não apaga a flag. Só um login ou cadastro explícito
 * com sucesso chama `clearLoggedOutFlag`.
 */

import { requestLogout } from '../api/sessionHttp';

export const LOGGED_OUT_KEY = 'mae.loggedOut';
export const LOGGED_OUT_VALUE = '1';

/** Igual a `REFRESH_LOCK_NAME`. O reenvio não corre em paralelo com um refresh. */
const LOGGED_OUT_LOCK_NAME = 'mae-web-session-refresh';
/** Igual a `SESSION_CHANNEL_NAME`. */
const LOGGED_OUT_CHANNEL_NAME = 'mae-web-session';

const RETRY_TTL_MS = 5_000;

let inflight: Promise<void> | null = null;
let peerRetryAt: number | null = null;
let lastSentId: string | null = null;
let channel: BroadcastChannel | null = null;

export function isLoggedOutFlag(): boolean {
  try {
    return window.localStorage.getItem(LOGGED_OUT_KEY) === LOGGED_OUT_VALUE;
  } catch {
    return false;
  }
}

/** Todo logout, com ou sem rede. Síncrono, antes do POST. */
export function markLoggedOut(): void {
  try {
    window.localStorage.setItem(LOGGED_OUT_KEY, LOGGED_OUT_VALUE);
  } catch {
    // Storage indisponível: a aba ainda limpa a memória.
  }
}

/** Só depois de login ou cadastro explícito bem-sucedido. */
export function clearLoggedOutFlag(): void {
  try {
    window.localStorage.removeItem(LOGGED_OUT_KEY);
  } catch {
    // Sem storage, não há flag para limpar.
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
    channel = new BroadcastChannel(LOGGED_OUT_CHANNEL_NAME);
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

async function sendOnce(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<void> {
  const locks =
    typeof navigator !== 'undefined' && navigator.locks != null ? navigator.locks : null;
  if (locks) {
    await locks.request(LOGGED_OUT_LOCK_NAME, async () => {
      ensureChannel();
      await drainPeer();
      if (peerFresh()) {
        return;
      }
      if (!isLoggedOutFlag()) return;
      await requestLogout(apiBaseUrl, fetchImpl);
      publishRetry(Date.now());
    });
    return;
  }
  ensureChannel();
  if (peerFresh()) {
    return;
  }
  await Promise.resolve();
  if (!isLoggedOutFlag()) return;
  await requestLogout(apiBaseUrl, fetchImpl);
  publishRetry(Date.now());
}

/**
 * Reenvia `POST /auth/logout` (credentials + X-MAE-CSRF) uma vez por aba
 * enquanto a chamada está em curso. O status da resposta não remove a flag.
 */
export function retryLoggedOut(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<void> {
  if (!isLoggedOutFlag()) {
    return Promise.resolve();
  }
  if (inflight) {
    return inflight;
  }
  inflight = sendOnce(apiBaseUrl, fetchImpl).finally(() => {
    inflight = null;
  });
  return inflight;
}

export function resetLoggedOutForTests(): void {
  inflight = null;
  peerRetryAt = null;
  lastSentId = null;
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
