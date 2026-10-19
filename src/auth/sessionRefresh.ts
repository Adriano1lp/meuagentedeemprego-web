/**
 * Um refresh por vez na aba (promise compartilhada) e entre abas
 * (navigator.locks, nome fixo). Sem Web Locks, o BroadcastChannel elege
 * um líder. A aba que não liderou espera o grant ou a falha por até
 * FOLLOWER_GRANT_WAIT_MS e, se nada chegar, falha fechado — sem outro POST.
 * O token só atravessa o canal efêmero para a aba que esperou
 * o mesmo refresh — não vai para localStorage, sessionStorage, cookie
 * legível nem console.
 */

import {
  requestRefresh,
  SessionExpiredError,
  type AccessGrant,
} from '../api/sessionHttp';
import { isLoggedOutFlag } from './loggedOut';

export const REFRESH_LOCK_NAME = 'mae-web-session-refresh';
export const SESSION_CHANNEL_NAME = 'mae-web-session';

const PEER_TTL_MS = 5_000;

/**
 * Sem `navigator.locks`, a aba que não liderou espera o grant ou a falha
 * neste prazo. Não dispara outro POST /auth/refresh.
 */
export const FOLLOWER_GRANT_WAIT_MS = 5_000;

export type SessionEvent = { type: 'logout' } | { type: 'session-expired' };

type Listener = (event: SessionEvent) => void;

type PeerWaiter = {
  settle: (outcome: 'grant' | 'failed' | 'timeout') => void;
  timer: ReturnType<typeof setTimeout>;
};

type WireMessage =
  | { v: 1; type: 'grant'; accessToken: string; expiresIn: number | null; at: number }
  | { v: 1; type: 'refresh-failed'; at: number }
  | { v: 1; type: 'logout' }
  | { v: 1; type: 'session-expired' }
  | { v: 1; type: 'claim'; id: string };

type ChannelLike = {
  postMessage: (message: WireMessage) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  close: () => void;
};

export type SessionCoordinatorDeps = {
  postRefresh: () => Promise<AccessGrant>;
  locks?: LockManager | null;
  createChannel?: () => ChannelLike | null;
  now?: () => number;
  /** No jsdom o drain é pulado para o boot caber em microtasks. */
  drain?: () => Promise<void>;
};

export type SessionCoordinator = {
  refresh: () => Promise<AccessGrant>;
  notifyLogout: () => void;
  notifySessionExpired: () => void;
  subscribe: (listener: Listener) => () => void;
  reset: () => void;
};

function defaultNow(): number {
  return Date.now();
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

async function drainBroadcastTasks(): Promise<void> {
  if (isJsdom() || typeof MessageChannel === 'undefined') {
    return;
  }
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLocks(explicit: LockManager | null | undefined): LockManager | null {
  if (explicit === null) {
    return null;
  }
  if (explicit) {
    return explicit;
  }
  if (typeof navigator !== 'undefined' && navigator.locks != null) {
    return navigator.locks;
  }
  return null;
}

function readChannelFactory(
  explicit: (() => ChannelLike | null) | undefined,
): () => ChannelLike | null {
  if (explicit) {
    return explicit;
  }
  return () => {
    if (typeof BroadcastChannel === 'undefined') {
      return null;
    }
    try {
      return new BroadcastChannel(SESSION_CHANNEL_NAME);
    } catch {
      return null;
    }
  };
}

export function createSessionCoordinator(deps: SessionCoordinatorDeps): SessionCoordinator {
  const now = deps.now ?? defaultNow;
  const postRefresh = deps.postRefresh;
  const locks = readLocks(deps.locks);
  const createChannel = readChannelFactory(deps.createChannel);
  const drain = deps.drain ?? drainBroadcastTasks;
  const listeners = new Set<Listener>();
  let channel: ChannelLike | null = null;
  let inflight: Promise<AccessGrant> | null = null;
  let peerGrant: { grant: AccessGrant; at: number } | null = null;
  let peerFailureAt: number | null = null;
  const claims = new Set<string>();
  const peerWaiters = new Set<PeerWaiter>();

  function emit(event: SessionEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function rememberGrant(accessToken: string, expiresIn: number | null, at: number): void {
    if (!accessToken.trim()) {
      return;
    }
    peerGrant = { grant: { accessToken, expiresIn }, at };
    peerFailureAt = null;
    notifyPeerWaiters();
  }

  function rememberFailure(at: number): void {
    peerFailureAt = at;
    peerGrant = null;
    notifyPeerWaiters();
  }

  function peekPeerOutcome(): 'grant' | 'failed' | null {
    if (peerGrant && now() - peerGrant.at <= PEER_TTL_MS) {
      return 'grant';
    }
    if (peerFailureAt != null && now() - peerFailureAt <= PEER_TTL_MS) {
      return 'failed';
    }
    return null;
  }

  function finishPeerWaiter(
    waiter: PeerWaiter,
    outcome: 'grant' | 'failed' | 'timeout',
  ): void {
    if (!peerWaiters.has(waiter)) {
      return;
    }
    clearTimeout(waiter.timer);
    peerWaiters.delete(waiter);
    waiter.settle(outcome);
  }

  function notifyPeerWaiters(): void {
    const outcome = peekPeerOutcome();
    if (!outcome) {
      return;
    }
    for (const waiter of [...peerWaiters]) {
      finishPeerWaiter(waiter, outcome);
    }
  }

  function waitForPeerOutcome(
    timeoutMs: number,
  ): Promise<'grant' | 'failed' | 'timeout'> {
    const immediate = peekPeerOutcome();
    if (immediate) {
      return Promise.resolve(immediate);
    }
    return new Promise((resolve) => {
      const waiter: PeerWaiter = {
        settle: resolve,
        timer: setTimeout(() => {
          finishPeerWaiter(waiter, peekPeerOutcome() ?? 'timeout');
        }, timeoutMs),
      };
      peerWaiters.add(waiter);
    });
  }

  function takePeerGrant(): AccessGrant | null {
    if (!peerGrant || now() - peerGrant.at > PEER_TTL_MS) {
      peerGrant = null;
      return null;
    }
    const grant = peerGrant.grant;
    peerGrant = null;
    return grant;
  }

  function takePeerFailure(): boolean {
    if (peerFailureAt == null || now() - peerFailureAt > PEER_TTL_MS) {
      peerFailureAt = null;
      return false;
    }
    peerFailureAt = null;
    return true;
  }

  function ensureChannel(): ChannelLike | null {
    if (channel) {
      return channel;
    }
    channel = createChannel();
    if (!channel) {
      return null;
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as WireMessage | null;
      if (!data || data.v !== 1) {
        return;
      }
      if (data.type === 'grant' && typeof data.accessToken === 'string') {
        rememberGrant(data.accessToken, data.expiresIn ?? null, data.at || now());
        return;
      }
      if (data.type === 'refresh-failed') {
        rememberFailure(data.at || now());
        return;
      }
      if (data.type === 'claim' && typeof data.id === 'string') {
        claims.add(data.id);
        return;
      }
      if (data.type === 'logout') {
        emit({ type: 'logout' });
        return;
      }
      if (data.type === 'session-expired') {
        emit({ type: 'session-expired' });
      }
    };
    channel.addEventListener('message', onMessage);
    return channel;
  }

  function publish(message: WireMessage): void {
    ensureChannel()?.postMessage(message);
  }

  async function postAndAnnounce(): Promise<AccessGrant> {
    if (isLoggedOutFlag()) {
      throw new SessionExpiredError();
    }
    try {
      const grant = await postRefresh();
      publish({
        v: 1,
        type: 'grant',
        accessToken: grant.accessToken,
        expiresIn: grant.expiresIn,
        at: now(),
      });
      return grant;
    } catch (error) {
      publish({ v: 1, type: 'refresh-failed', at: now() });
      throw error;
    }
  }

  async function refreshInsideLock(): Promise<AccessGrant> {
    await drain();
    const shared = takePeerGrant();
    if (shared) {
      return shared;
    }
    if (takePeerFailure()) {
      throw new SessionExpiredError();
    }
    return postAndAnnounce();
  }

  async function refreshWithLock(): Promise<AccessGrant> {
    if (!locks) {
      return refreshWithClaim();
    }
    const inner = await locks.request(REFRESH_LOCK_NAME, () => refreshInsideLock());
    return await inner;
  }

  async function refreshWithClaim(): Promise<AccessGrant> {
    const id = randomId();
    claims.add(id);
    publish({ v: 1, type: 'claim', id });
    await drain();
    const leader = [...claims].sort()[0] === id;
    claims.clear();
    const shared = takePeerGrant();
    if (shared) {
      return shared;
    }
    if (takePeerFailure()) {
      throw new SessionExpiredError();
    }
    if (!leader) {
      // Não renova por conta própria: um segundo POST reusa o refresh token.
      const outcome = await waitForPeerOutcome(FOLLOWER_GRANT_WAIT_MS);
      if (isLoggedOutFlag()) {
        throw new SessionExpiredError();
      }
      if (outcome === 'grant') {
        const grant = takePeerGrant();
        if (grant) {
          return grant;
        }
      }
      throw new SessionExpiredError();
    }
    return postAndAnnounce();
  }

  async function refreshExclusive(): Promise<AccessGrant> {
    ensureChannel();
    return refreshWithLock();
  }

  return {
    refresh() {
      if (isLoggedOutFlag()) {
        return Promise.reject(new SessionExpiredError());
      }
      if (inflight) {
        return inflight;
      }
      inflight = refreshExclusive().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    notifyLogout() {
      publish({ v: 1, type: 'logout' });
    },
    notifySessionExpired() {
      publish({ v: 1, type: 'session-expired' });
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureChannel();
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      inflight = null;
      peerGrant = null;
      peerFailureAt = null;
      claims.clear();
      for (const waiter of [...peerWaiters]) {
        finishPeerWaiter(waiter, 'timeout');
      }
    },
  };
}

let refreshImpl: () => Promise<AccessGrant> = async () => {
  throw new SessionExpiredError();
};

let singleton: SessionCoordinator | null = null;
let restoreFlight: Promise<AccessGrant | null> | null = null;

export function setRefreshImplementation(fn: () => Promise<AccessGrant>): void {
  refreshImpl = fn;
}

export function getSessionCoordinator(): SessionCoordinator {
  if (!singleton) {
    singleton = createSessionCoordinator({
      postRefresh: () => refreshImpl(),
    });
  }
  return singleton;
}

/** Um boot por carregamento. O StrictMode reentra na mesma promise. */
export function restoreSessionOnce(): Promise<AccessGrant | null> {
  if (!restoreFlight) {
    restoreFlight = getSessionCoordinator()
      .refresh()
      .catch(() => null);
  }
  return restoreFlight;
}

export function resetSessionRuntimeForTests(): void {
  restoreFlight = null;
  singleton?.reset();
  singleton = null;
  refreshImpl = async () => {
    throw new SessionExpiredError();
  };
}

export async function refreshWithApi(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
): Promise<AccessGrant> {
  return requestRefresh(apiBaseUrl, fetchImpl);
}
