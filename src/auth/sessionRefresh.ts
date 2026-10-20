/**
 * Um refresh por vez na aba (promise compartilhada) e entre abas
 * (navigator.locks, nome fixo). Sem Web Locks, o BroadcastChannel elege
 * quem renova. O token só atravessa o canal efêmero para a aba que
 * esperou o mesmo refresh — não vai para localStorage, sessionStorage,
 * cookie legível nem console.
 *
 * Invariáveis de uma rodada (N abas, nenhuma chegou com token), com ou sem
 * Web Locks:
 * - No máximo um POST /auth/refresh.
 * - Exatamente um POST quando o líder conclui. As outras esperam o grant
 *   ou a falha. Se o líder morre no meio do POST, quem viu o refreshing
 *   não faz outro POST.
 *
 * Com Web Locks, dentro do lock: um grant recente no canal é reaproveitado.
 * Se o canal perdeu o aviso, vale a marca em localStorage (sem token) pelo
 * mesmo PEER_TTL_MS. Refresh em curso de outra aba espera o grant. Grant
 * recente espera de novo pelo canal e, se não chegar, falha fechado sem POST.
 * Sem localStorage, segue só o canal. O evento storage repete o refreshing.
 *
 * Sem Web Locks, quem não lidera nunca manda claim-ack: republica o
 * refreshing do líder que já conhece, ou fica calada. Refreshing só é
 * anunciado por quem está de fato no POST e vence qualquer id. Se ninguém
 * está no POST, o menor id desempata. Mesmo com ack, o POST espera
 * CLAIM_COLLISION_MS sem nenhum refreshing. A seguidora espera o grant ou
 * a falha por até FOLLOWER_GRANT_WAIT_MS.
 */

import {
  requestRefresh,
  SessionExpiredError,
  type AccessGrant,
} from '../api/sessionHttp';
import { isLoggedOutFlag } from './loggedOut';

export const REFRESH_LOCK_NAME = 'mae-web-session-refresh';
export const SESSION_CHANNEL_NAME = 'mae-web-session';

/** Sem token: só quem está renovando, ou o instante do último grant. */
export const SESSION_REFRESH_MARK_KEY = 'mae.sessionRefresh';

type RefreshMark = { tabId: string; startedAt: number } | { at: number };

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

/**
 * Janela curta imediatamente antes do POST. Mesmo que o ack já tenha
 * chegado, sem nenhum refreshing nesse intervalo não há segundo POST.
 */
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

let tabSerial = 0;

/** Não usa randomUUID: a eleição sem locks reserva esses ids para o claim. */
function nextTabId(): string {
  tabSerial += 1;
  return `tab-${tabSerial}-${Math.random().toString(16).slice(2)}`;
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
  let announcedGrant: { grant: AccessGrant; at: number } | null = null;
  let peerFailureAt: number | null = null;
  let peerFailureConfirmed = false;
  const claims = new Map<string, number>();
  const acks = new Set<string>();
  let attemptId: string | null = null;
  let refreshingId: string | null = null;
  let posting = false;
  let peerRefreshingId: string | null = null;
  let peerRefreshingAt: number | null = null;
  const grantTold = new Set<string>();
  const peerWaiters = new Set<PeerWaiter>();
  const claimWaiters = new Set<ClaimWaiter>();
  const tabId = nextTabId();
  let ownGrantAt: number | null = null;
  let storageBound = false;

  function emit(event: SessionEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function holdAnnouncedGrant(grant: AccessGrant, at: number): void {
    if (!grant.accessToken.trim()) {
      return;
    }
    announcedGrant = { grant, at };
    grantTold.clear();
  }

  function clearAnnouncedGrant(): void {
    announcedGrant = null;
    grantTold.clear();
  }

  /** No máximo um grant por aba que pediu, dentro do prazo. */
  function republishAnnouncedGrant(requesterId: string): void {
    if (!requesterId) {
      return;
    }
    if (!announcedGrant || now() - announcedGrant.at > PEER_TTL_MS) {
      clearAnnouncedGrant();
      return;
    }
    if (isLoggedOutFlag() || grantTold.has(requesterId)) {
      return;
    }
    grantTold.add(requesterId);
    publish({
      v: 1,
      type: 'grant',
      accessToken: announcedGrant.grant.accessToken,
      expiresIn: announcedGrant.grant.expiresIn,
      at: announcedGrant.at,
    });
  }

  function rememberGrant(accessToken: string, expiresIn: number | null, at: number): void {
    if (!accessToken.trim()) {
      return;
    }
    const grant = { accessToken, expiresIn };
    peerGrant = { grant, at };
    holdAnnouncedGrant(grant, at);
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
    clearAnnouncedGrant();
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

  function readRefreshMark(): RefreshMark | null {
    try {
      const raw = window.localStorage.getItem(SESSION_REFRESH_MARK_KEY);
      if (!raw) {
        return null;
      }
      const data = JSON.parse(raw) as {
        tabId?: unknown;
        startedAt?: unknown;
        at?: unknown;
      } | null;
      if (!data || typeof data !== 'object') {
        return null;
      }
      if (typeof data.tabId === 'string' && typeof data.startedAt === 'number') {
        return { tabId: data.tabId, startedAt: data.startedAt };
      }
      if (typeof data.at === 'number') {
        return { at: data.at };
      }
      return null;
    } catch {
      return null;
    }
  }

  function writeRefreshMark(mark: RefreshMark): void {
    try {
      window.localStorage.setItem(SESSION_REFRESH_MARK_KEY, JSON.stringify(mark));
    } catch {
      if (!('tabId' in mark)) {
        clearOwnRefreshingMark();
      }
    }
  }

  function removeRefreshMark(): void {
    try {
      window.localStorage.removeItem(SESSION_REFRESH_MARK_KEY);
    } catch {
      // Sem storage, não há marca para apagar.
    }
  }

  function clearOwnRefreshingMark(): void {
    const mark = readRefreshMark();
    if (mark && 'tabId' in mark && mark.tabId === tabId) {
      removeRefreshMark();
    }
  }

  function clearOwnGrantMark(): void {
    const mark = readRefreshMark();
    if (mark && 'at' in mark && !('tabId' in mark) && mark.at === ownGrantAt) {
      removeRefreshMark();
    }
  }

  function foreignRefreshingMark(): { tabId: string; startedAt: number } | null {
    const mark = readRefreshMark();
    if (!mark || !('tabId' in mark)) {
      return null;
    }
    if (mark.tabId === tabId || now() - mark.startedAt > PEER_TTL_MS) {
      return null;
    }
    return mark;
  }

  function foreignGrantMark(): number | null {
    const mark = readRefreshMark();
    if (!mark || !('at' in mark) || 'tabId' in mark) {
      return null;
    }
    if (mark.at === ownGrantAt || now() - mark.at > PEER_TTL_MS) {
      return null;
    }
    return mark.at;
  }

  function noteForeignRefreshing(mark: { tabId: string; startedAt: number }): void {
    peerRefreshingId = mark.tabId;
    peerRefreshingAt = mark.startedAt;
  }

  function askForStoredGrant(): void {
    if (posting || isLoggedOutFlag()) {
      return;
    }
    if (peerGrant && now() - peerGrant.at <= PEER_TTL_MS) {
      return;
    }
    const id = randomId();
    const previous = attemptId;
    attemptId = id;
    publish({ v: 1, type: 'claim', id });
    if (previous && previous !== id) {
      attemptId = previous;
    }
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== SESSION_REFRESH_MARK_KEY || !event.newValue) {
      return;
    }
    const mark = readRefreshMark();
    if (!mark) {
      return;
    }
    if ('tabId' in mark) {
      if (mark.tabId !== tabId && now() - mark.startedAt <= PEER_TTL_MS) {
        noteForeignRefreshing(mark);
        notifyClaimWaiters();
      }
      return;
    }
    if (peerWaiters.size > 0 && mark.at !== ownGrantAt && now() - mark.at <= PEER_TTL_MS) {
      askForStoredGrant();
    }
  }

  function onPageHide(event: Event): void {
    if ('persisted' in event && Boolean((event as PageTransitionEvent).persisted)) {
      return;
    }
    clearOwnGrantMark();
  }

  function ensureStorageListener(): void {
    if (storageBound || typeof window === 'undefined') {
      return;
    }
    storageBound = true;
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
  }

  function unbindStorage(): void {
    if (!storageBound || typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pagehide', onPageHide);
    storageBound = false;
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
    const peer = livePeerRefreshing();
    if (peer && peer !== selfId) {
      return false;
    }
    const ids = [selfId, ...foreignClaimIds(selfId)];
    ids.sort();
    return ids[0] === selfId;
  }

  function knowsForeignRefreshing(selfId: string | null): boolean {
    const peer = livePeerRefreshing();
    return peer != null && peer !== selfId;
  }

  /** Seguidora: não é o menor id, ou já existe quem está no POST. */
  function actingAsFollower(selfId: string): boolean {
    return knowsForeignRefreshing(selfId) || !leaderIs(selfId);
  }

  function armAttempt(id: string): void {
    attemptId = id;
    refreshingId = null;
    acks.clear();
    claims.set(id, now());
    if (actingAsFollower(id)) {
      return;
    }
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
        const known = claims.has(data.id);
        claims.set(data.id, now());
        if (posting) {
          const activeId = refreshingId ?? attemptId;
          if (activeId) {
            publish({ v: 1, type: 'refreshing', id: activeId });
          }
          notifyClaimWaiters();
          return;
        }
        const leaderRefreshing = livePeerRefreshing();
        // Seguidora não confirma claim. Só repete o refreshing do líder, ou fica calada.
        if (
          (leaderRefreshing && leaderRefreshing !== attemptId) ||
          (attemptId != null && actingAsFollower(attemptId))
        ) {
          if (leaderRefreshing && leaderRefreshing !== attemptId) {
            publish({ v: 1, type: 'refreshing', id: leaderRefreshing });
          }
          notifyClaimWaiters();
          return;
        }
        republishAnnouncedGrant(data.id);
        if (attemptId && data.id !== attemptId && !actingAsFollower(attemptId)) {
          publish({ v: 1, type: 'claim-ack', id: data.id, from: attemptId });
          if (!known) {
            publish({ v: 1, type: 'claim', id: attemptId });
          }
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
        clearAnnouncedGrant();
        emit({ type: 'logout' });
        return;
      }
      if (data.type === 'session-expired') {
        clearAnnouncedGrant();
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
    posting = true;
    const activeId = refreshingId ?? attemptId;
    if (activeId) {
      refreshingId = activeId;
      publish({ v: 1, type: 'refreshing', id: activeId });
    }
    try {
      const grant = await postRefresh();
      const at = now();
      holdAnnouncedGrant(grant, at);
      publish({
        v: 1,
        type: 'grant',
        accessToken: grant.accessToken,
        expiresIn: grant.expiresIn,
        at,
      });
      return grant;
    } catch (error) {
      publish({ v: 1, type: 'refresh-failed', at: now() });
      throw error;
    } finally {
      posting = false;
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
    // Canal ou marca: refresh de outra aba ainda vale. Sem segundo POST.
    const markedRefreshing = foreignRefreshingMark();
    if (livePeerRefreshing() || markedRefreshing) {
      if (markedRefreshing) {
        noteForeignRefreshing(markedRefreshing);
      }
      return followOrFail();
    }
    if (foreignGrantMark() != null) {
      askForStoredGrant();
      try {
        return await followOrFail();
      } finally {
        if (!posting) {
          attemptId = null;
        }
      }
    }
    const id = randomId();
    attemptId = id;
    refreshingId = id;
    writeRefreshMark({ tabId, startedAt: now() });
    try {
      const grant = await postAndAnnounce();
      const at = now();
      ownGrantAt = at;
      writeRefreshMark({ at });
      return grant;
    } catch (error) {
      clearOwnRefreshingMark();
      throw error;
    } finally {
      if (attemptId === id) {
        attemptId = null;
      }
      if (refreshingId === id) {
        refreshingId = null;
      }
    }
  }

  async function refreshWithLock(): Promise<AccessGrant> {
    if (!locks) {
      return refreshWithClaim();
    }
    const inner = await locks.request(REFRESH_LOCK_NAME, () => refreshInsideLock());
    return await inner;
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

      await waitUntil(
        CLAIM_CONFIRM_MS,
        () =>
          foreignClaimIds(id).length > 0 ||
          knowsForeignRefreshing(id) ||
          peekPeerOutcome() != null,
      );

      const afterWait = takePeerGrant();
      if (afterWait) {
        return afterWait;
      }
      const afterFailure = takePeerFailure();
      if (afterFailure) {
        throw afterFailure;
      }
      if (actingAsFollower(id)) {
        return await followOrFail();
      }

      await waitUntil(
        CLAIM_COLLISION_MS,
        () => actingAsFollower(id) || peekPeerOutcome() != null,
      );

      const quietGrant = takePeerGrant();
      if (quietGrant) {
        return quietGrant;
      }
      const quietFailure = takePeerFailure();
      if (quietFailure) {
        throw quietFailure;
      }
      if (actingAsFollower(id)) {
        return await followOrFail();
      }
      return await postAndAnnounce();
    } finally {
      posting = false;
      attemptId = null;
      refreshingId = null;
      claims.clear();
      acks.clear();
    }
  }

  async function refreshExclusive(): Promise<AccessGrant> {
    ensureChannel();
    ensureStorageListener();
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
      ensureStorageListener();
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      inflight = null;
      peerGrant = null;
      clearAnnouncedGrant();
      posting = false;
      clearOwnRefreshingMark();
      clearOwnGrantMark();
      ownGrantAt = null;
      unbindStorage();
      try {
        channel?.close();
      } catch {
        // Canal já fechado.
      }
      channel = null;
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
