/**
 * Um refresh por vez na aba (promise compartilhada) e entre abas
 * (navigator.locks, nome fixo). Sem Web Locks, o BroadcastChannel elege
 * um líder e só renova depois do ack do claim. Sem essa confirmação,
 * a aba falha fechado — sem outro POST. A seguidora espera o grant ou
 * a falha por até FOLLOWER_GRANT_WAIT_MS.
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

/**
 * Sem locks, a aba espera outro claim antes de concluir que está sozinha.
 * Se aparecer um par e o ack não chegar, não há POST.
 */
export const CLAIM_CONFIRM_MS = 300;

/** Segunda janela, curta, para dois F5 que ainda não se viram. */
export const CLAIM_COLLISION_MS = 100;

export type SessionEvent = { type: 'logout' } | { type: 'session-expired' };

type Listener = (event: SessionEvent) => void;

type PeerWaiter = {
  settle: (outcome: 'grant' | 'failed' | 'timeout') => void;
  timer: ReturnType<typeof setTimeout>;
};

type ClaimWaiter = {
  ready: () => boolean;
  settle: () => void;
  timer: ReturnType<typeof setTimeout>;
};

type WireMessage =
  | { v: 1; type: 'grant'; accessToken: string; expiresIn: number | null; at: number }
  | { v: 1; type: 'refresh-failed'; at: number }
  | { v: 1; type: 'logout' }
  | { v: 1; type: 'session-expired' }
  | { v: 1; type: 'claim'; id: string }
  | { v: 1; type: 'claim-ack'; id: string; from: string }
  | { v: 1; type: 'refreshing'; id: string };

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
  let peerFailureConfirmed = false;
  const claims = new Map<string, number>();
  const acks = new Set<string>();
  let attemptId: string | null = null;
  let refreshingId: string | null = null;
  let peerRefreshingId: string | null = null;
  let peerRefreshingAt: number | null = null;
  const peerWaiters = new Set<PeerWaiter>();
  const claimWaiters = new Set<ClaimWaiter>();

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
    peerFailureConfirmed = false;
    peerRefreshingId = null;
    peerRefreshingAt = null;
    notifyPeerWaiters();
    notifyClaimWaiters();
  }

  function rememberFailure(at: number, confirmed: boolean): void {
    peerFailureAt = at;
    peerFailureConfirmed = confirmed;
    peerGrant = null;
    peerRefreshingId = null;
    peerRefreshingAt = null;
    notifyPeerWaiters();
    notifyClaimWaiters();
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

  function takePeerFailure(): SessionExpiredError | null {
    if (peerFailureAt == null || now() - peerFailureAt > PEER_TTL_MS) {
      peerFailureAt = null;
      peerFailureConfirmed = false;
      return null;
    }
    const confirmed = peerFailureConfirmed;
    peerFailureAt = null;
    peerFailureConfirmed = false;
    return new SessionExpiredError(confirmed);
  }

  function finishClaimWaiter(waiter: ClaimWaiter): void {
    if (!claimWaiters.has(waiter)) {
      return;
    }
    clearTimeout(waiter.timer);
    claimWaiters.delete(waiter);
    waiter.settle();
  }

  function notifyClaimWaiters(): void {
    for (const waiter of [...claimWaiters]) {
      if (waiter.ready()) {
        finishClaimWaiter(waiter);
      }
    }
  }

  function waitUntil(timeoutMs: number, ready: () => boolean): Promise<void> {
    if (ready()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiter: ClaimWaiter = {
        ready,
        settle: resolve,
        timer: setTimeout(() => finishClaimWaiter(waiter), timeoutMs),
      };
      claimWaiters.add(waiter);
    });
  }

  function livePeerRefreshing(): string | null {
    if (peerRefreshingId == null || peerRefreshingAt == null) {
      return null;
    }
    if (now() - peerRefreshingAt > PEER_TTL_MS) {
      peerRefreshingId = null;
      peerRefreshingAt = null;
      return null;
    }
    return peerRefreshingId;
  }

  function foreignClaimIds(selfId: string): string[] {
    const cutoff = now() - PEER_TTL_MS;
    const ids: string[] = [];
    for (const [claimId, at] of claims) {
      if (at < cutoff) {
        claims.delete(claimId);
        continue;
      }
      if (claimId !== selfId) {
        ids.push(claimId);
      }
    }
    return ids;
  }

  function leaderIs(selfId: string): boolean {
    const ids = [selfId, ...foreignClaimIds(selfId)];
    const peer = livePeerRefreshing();
    if (peer && peer !== selfId) {
      ids.push(peer);
    }
    ids.sort();
    return ids[0] === selfId;
  }

  function peersAcked(selfId: string): boolean {
    return foreignClaimIds(selfId).every((claimId) => acks.has(claimId));
  }

  function armAttempt(id: string): void {
    attemptId = id;
    refreshingId = null;
    acks.clear();
    claims.set(id, now());
    for (const peerId of foreignClaimIds(id)) {
      publish({ v: 1, type: 'claim-ack', id: peerId, from: id });
    }
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
        // A falha anunciada não confirma 401 nesta aba. Quem fez o POST é que confirma.
        rememberFailure(data.at || now(), false);
        return;
      }
      if (data.type === 'claim' && typeof data.id === 'string') {
        claims.set(data.id, now());
        if (attemptId && data.id !== attemptId) {
          publish({ v: 1, type: 'claim-ack', id: data.id, from: attemptId });
        }
        if (refreshingId) {
          publish({ v: 1, type: 'refreshing', id: refreshingId });
        }
        notifyClaimWaiters();
        return;
      }
      if (
        data.type === 'claim-ack' &&
        typeof data.id === 'string' &&
        typeof data.from === 'string' &&
        data.id === attemptId
      ) {
        acks.add(data.from);
        notifyClaimWaiters();
        return;
      }
      if (data.type === 'refreshing' && typeof data.id === 'string' && data.id !== attemptId) {
        peerRefreshingId = data.id;
        peerRefreshingAt = now();
        claims.set(data.id, now());
        notifyClaimWaiters();
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
    const peerError = takePeerFailure();
    if (peerError) {
      throw peerError;
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

  function failClosed(): never {
    publish({ v: 1, type: 'refresh-failed', at: now() });
    throw new SessionExpiredError(false);
  }

  async function followOrFail(): Promise<AccessGrant> {
    const outcome = await waitForPeerOutcome(FOLLOWER_GRANT_WAIT_MS);
    if (isLoggedOutFlag()) {
      throw new SessionExpiredError(false);
    }
    if (outcome === 'grant') {
      const grant = takePeerGrant();
      if (grant) {
        return grant;
      }
    }
    if (outcome === 'failed') {
      throw takePeerFailure() ?? new SessionExpiredError(false);
    }
    throw new SessionExpiredError(false);
  }

  async function finishAsLeader(id: string): Promise<AccessGrant> {
    const smallerPeer = () => {
      const peer = livePeerRefreshing();
      return peer != null && peer < id;
    };
    if (!leaderIs(id) || smallerPeer()) {
      return followOrFail();
    }
    if (foreignClaimIds(id).length > 0 && !peersAcked(id)) {
      await waitUntil(
        CLAIM_CONFIRM_MS,
        () => peersAcked(id) || !leaderIs(id) || smallerPeer() || peekPeerOutcome() != null,
      );
    }
    const shared = takePeerGrant();
    if (shared) {
      return shared;
    }
    const peerError = takePeerFailure();
    if (peerError) {
      throw peerError;
    }
    if (!leaderIs(id) || smallerPeer()) {
      return followOrFail();
    }
    if (foreignClaimIds(id).length > 0 && !peersAcked(id)) {
      return failClosed();
    }
    refreshingId = id;
    publish({ v: 1, type: 'refreshing', id });
    await drain();
    if (smallerPeer()) {
      refreshingId = null;
      return followOrFail();
    }
    if (foreignClaimIds(id).length > 0 && !peersAcked(id)) {
      refreshingId = null;
      return failClosed();
    }
    try {
      return await postAndAnnounce();
    } finally {
      refreshingId = null;
    }
  }

  async function refreshWithClaim(): Promise<AccessGrant> {
    const initialGrant = takePeerGrant();
    if (initialGrant) {
      return initialGrant;
    }
    const initialFailure = takePeerFailure();
    if (initialFailure) {
      throw initialFailure;
    }

    const id = randomId();
    try {
      armAttempt(id);
      publish({ v: 1, type: 'claim', id });
      await drain();

      if (!channel) {
        return await postAndAnnounce();
      }

      if (foreignClaimIds(id).length === 0 && livePeerRefreshing() == null) {
        await waitUntil(
          CLAIM_CONFIRM_MS,
          () =>
            foreignClaimIds(id).length > 0 ||
            livePeerRefreshing() != null ||
            peekPeerOutcome() != null,
        );
      }

      const afterWait = takePeerGrant();
      if (afterWait) {
        return afterWait;
      }
      const afterFailure = takePeerFailure();
      if (afterFailure) {
        throw afterFailure;
      }

      if (foreignClaimIds(id).length === 0 && livePeerRefreshing() == null) {
        refreshingId = id;
        publish({ v: 1, type: 'refreshing', id });
        await waitUntil(
          CLAIM_COLLISION_MS,
          () =>
            foreignClaimIds(id).length > 0 ||
            (livePeerRefreshing() != null && livePeerRefreshing() !== id) ||
            peekPeerOutcome() != null,
        );
        const collidedGrant = takePeerGrant();
        if (collidedGrant) {
          return collidedGrant;
        }
        const collidedFailure = takePeerFailure();
        if (collidedFailure) {
          throw collidedFailure;
        }
        if (
          foreignClaimIds(id).length === 0 &&
          (livePeerRefreshing() == null || livePeerRefreshing() === id)
        ) {
          return await postAndAnnounce();
        }
        refreshingId = null;
      }

      if (!leaderIs(id)) {
        return await followOrFail();
      }
      return await finishAsLeader(id);
    } finally {
      attemptId = null;
      refreshingId = null;
      claims.clear();
      acks.clear();
    }
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
      peerFailureConfirmed = false;
      attemptId = null;
      refreshingId = null;
      peerRefreshingId = null;
      peerRefreshingAt = null;
      claims.clear();
      acks.clear();
      for (const waiter of [...peerWaiters]) {
        finishPeerWaiter(waiter, 'timeout');
      }
      for (const waiter of [...claimWaiters]) {
        finishClaimWaiter(waiter);
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
