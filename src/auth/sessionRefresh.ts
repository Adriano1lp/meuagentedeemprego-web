/**
 * Um refresh por vez na aba (promise compartilhada) e entre abas.
 * A coordenação é um lease único em localStorage, sem token. O Web Lock
 * só cobre a aquisição. O token fica em memória e, no máximo, atravessa
 * o BroadcastChannel para quem esperou aquele leaseId.
 *
 * mae.sessionLease = {leaseId, epoch, owner, until, phase}.
 * phase: 'open' | 'sending' | 'done'.
 *
 * L (LEASE_OPEN_MS) é a janela do open e o until renovado no sending.
 * G (LEASE_DONE_MS) é a janela do done. Não aumentar.
 *
 * Sem Web Locks, a releitura e o fetch não são atômicos. Se duas abas
 * passarem por essa janela, o backend revoga a família: logout falso,
 * sem vazamento. Isso depende da rotação estrita no backend.
 *
 * Invariantes:
 * - No máximo um POST por lease.
 * - done com dono vivo: o ping devolve o grant e não há POST. Enquanto o
 *   done for nosso, o grant é republicado para a aba que abre o canal depois.
 * - done sem grant: o ping pede o token. Se o dono responde, não há POST.
 *   Se o grant não chega, só a primeira aba abre um epoch novo quando o
 *   done vence, com um POST sequencial no cookie já rotacionado.
 * - No pagehide, sem canal, o dono apaga só o próprio done. Com canal o
 *   done fica: apagá-lo no reload põe todas as abas no mint ao mesmo tempo
 *   e a janela entre a releitura e o fetch faz um segundo POST.
 * - Nada é gravado nem publicado com loggedOut ou com leaseId velho.
 * - O token não entra no storage.
 * - Sem canal, quem não é dona falha fechado, inclusive num done.
 * - sending nunca é retomado. No pagehide, se o fetch ainda não saiu, o
 *   dono apaga o próprio open ou sending (leaseId e owner seus). Se o
 *   fetch já saiu, o sending fica.
 * - Storage bloqueado e Web Lock: o lock cobre o POST e o grant vai no canal.
 * - Sem lock e sem storage: a primeira aba que anuncia no canal coordena e
 *   faz um POST. A perdedora espera o grant degradado até L e não faz POST.
 *   Se o grant não chega, falha fechado. O desempate é o anúncio mais cedo.
 */

import {
  requestRefresh,
  SessionExpiredError,
  type AccessGrant,
} from '../api/sessionHttp';
import { isLoggedOutFlag, LOGGED_OUT_KEY, LOGGED_OUT_VALUE } from './loggedOut';

export const REFRESH_LOCK_NAME = 'mae-web-session-refresh';
export const SESSION_CHANNEL_NAME = 'mae-web-session';

/** Lease sem token. A marca antiga mae.sessionRefresh não é mais lida. */
export const SESSION_LEASE_KEY = 'mae.sessionLease';

const LEGACY_MARK_KEY = 'mae.sessionRefresh';

/** L: open e renovação do until durante o POST. Não aumentar. */
export const LEASE_OPEN_MS = 5_000;

/** G: janela em que o done ainda pode ser lido. Não aumentar. */
export const LEASE_DONE_MS = 5_000;

/**
 * Ping ao dono de um done. Se o grant não volta neste prazo, o done
 * está sem dono vivo. Não é L nem G: esses continuam em 5s.
 */
export const GRANT_OWNER_PING_MS = 400;

/** Grant de storage bloqueado. Não é um leaseId e não entra no storage. */
const DEGRADED_LEASE_ID = 'degradado';

export const LEASE_JITTER_MIN_MS = 30;
export const LEASE_JITTER_MAX_MS = 80;

const HEARTBEAT_MS = 1_000;
const UNTIL_SKEW_MS = 1_000;

export type LeasePhase = 'open' | 'sending' | 'done';

export type SessionLease = {
  leaseId: string;
  epoch: number;
  owner: string;
  until: number;
  phase: LeasePhase;
};

const LEASE_KEYS = ['leaseId', 'epoch', 'owner', 'until', 'phase'] as const;

export type SessionEvent = { type: 'logout' } | { type: 'session-expired' };

type Listener = (event: SessionEvent) => void;

type WireMessage =
  | {
      v: 1;
      type: 'grant';
      leaseId: string;
      token: string;
      expiresIn: number | null;
    }
  | { v: 1; type: 'grant-please'; id: string; leaseId: string }
  | { v: 1; type: 'degraded-claim'; tabId: string; at: number }
  | { v: 1; type: 'degraded-commit'; tabId: string; at: number }
  | { v: 1; type: 'done-wait'; tabId: string; at: number; leaseId: string }
  | { v: 1; type: 'logout' }
  | { v: 1; type: 'session-expired' };

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
  /** Mantido para os testes. O lease não espera o dreno do canal. */
  drain?: () => Promise<void>;
};

export type SessionCoordinator = {
  refresh: () => Promise<AccessGrant>;
  notifyLogout: () => void;
  notifySessionExpired: () => void;
  subscribe: (listener: Listener) => () => void;
  reset: () => void;
};

type Inspect =
  | { kind: 'broken' }
  | { kind: 'empty'; nextEpoch: number }
  | { kind: 'invalid'; nextEpoch: number }
  | { kind: 'lease'; lease: SessionLease; nextEpoch: number };

type Outcome =
  | { kind: 'grant'; grant: AccessGrant }
  | { kind: 'detached'; pending: Promise<AccessGrant> };

type Announced = {
  leaseId: string;
  token: string;
  expiresIn: number | null;
};

const sessionCleaners = new Set<() => void>();
const wakes = new Set<() => void>();

function wakeAll(): void {
  for (const wake of [...wakes]) {
    wake();
  }
}

function defaultNow(): number {
  return Date.now();
}

function untilCeiling(at: number): number {
  return at + Math.max(LEASE_OPEN_MS, LEASE_DONE_MS) + UNTIL_SKEW_MS;
}

function nextJitter(): number {
  const span = LEASE_JITTER_MAX_MS - LEASE_JITTER_MIN_MS + 1;
  return LEASE_JITTER_MIN_MS + Math.floor(Math.random() * span);
}

function newLeaseId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new SessionExpiredError(false);
  }
  return crypto.randomUUID();
}

let tabSerial = 0;

function nextTabId(): string {
  tabSerial += 1;
  return `aba-${tabSerial}-${Math.random().toString(16).slice(2)}`;
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

const realSetTimeout = setTimeout;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Cede a vez às mensagens já enfileiradas. No WebKit, com a aba carregada,
 * o timer do ping pode rodar antes do BroadcastChannel; sem essa pausa o
 * dono vivo parece morto e a aba abre um POST sequencial.
 * Com timers falsos (teste) basta um timeout de 0, senão o relógio para.
 */
function yieldMacrotask(): Promise<void> {
  if (setTimeout !== realSetTimeout || typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return new Promise((resolve) => {
    const link = new MessageChannel();
    link.port1.onmessage = () => resolve();
    link.port2.postMessage(null);
  });
}

/**
 * Duas voltas: a primeira deixa o dono responder o grant-please; a segunda
 * entrega esse grant antes de abrir um epoch novo.
 */
async function drainMessages(): Promise<void> {
  await yieldMacrotask();
  await yieldMacrotask();
}

export function createSessionCoordinator(deps: SessionCoordinatorDeps): SessionCoordinator {
  const now = deps.now ?? defaultNow;
  const postRefresh = deps.postRefresh;
  const locks = readLocks(deps.locks);
  const createChannel = readChannelFactory(deps.createChannel);
  const listeners = new Set<Listener>();
  let channel: ChannelLike | null = null;
  let channelOpened = false;
  let inflight: Promise<AccessGrant> | null = null;
  let postInFlight: Promise<AccessGrant> | null = null;
  let postingLeaseId: string | null = null;
  let life = 0;
  let beatTimer: ReturnType<typeof setInterval> | null = null;
  let grantPulse: ReturnType<typeof setInterval> | null = null;
  let degradedReplyTimer: ReturnType<typeof setTimeout> | null = null;
  let degradedPulse: ReturnType<typeof setInterval> | null = null;
  const dispatched = new Set<string>();
  let announced: Announced | null = null;
  let degradedAt = 0;
  let degradedCoordinator = false;
  let degradedCommitted = false;
  const memoryGrants = new Map<string, { token: string; expiresIn: number | null }>();
  const consumed = new Set<string>();
  const answeredPlease = new Set<string>();
  const queuedPlease = new Map<string, string>();
  const pleaseIds = new Map<string, string>();
  const tabId = nextTabId();
  let storageBound = false;
  let pageHideBound = false;
  let degradedInbox: { token: string; expiresIn: number | null } | null = null;
  const degradedPeers = new Map<string, { at: number; commit: boolean }>();
  const doneWaiters = new Map<string, { tabId: string; at: number }>();

  function emit(event: SessionEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function stopHeartbeat(): void {
    if (beatTimer != null) {
      clearInterval(beatTimer);
      beatTimer = null;
    }
  }

  function stopGrantPulse(): void {
    if (grantPulse != null) {
      clearInterval(grantPulse);
      grantPulse = null;
    }
  }

  function stopDegradedReply(): void {
    if (degradedReplyTimer != null) {
      clearTimeout(degradedReplyTimer);
      degradedReplyTimer = null;
    }
  }

  function stopDegradedPulse(): void {
    if (degradedPulse != null) {
      clearInterval(degradedPulse);
      degradedPulse = null;
    }
  }

  function scheduleDegradedReply(): void {
    if (degradedReplyTimer != null || !degradedCoordinator || degradedAt === 0) {
      return;
    }
    degradedReplyTimer = setTimeout(() => {
      degradedReplyTimer = null;
      if (!degradedCoordinator || degradedAt === 0 || isLoggedOutFlag()) {
        return;
      }
      publish({ v: 1, type: 'degraded-claim', tabId, at: degradedAt });
    }, 0);
  }

  function startGrantPulse(leaseId: string, myLife: number): void {
    stopGrantPulse();
    const tick = () => {
      if (myLife !== life || isLoggedOutFlag() || !announced || announced.leaseId !== leaseId) {
        stopGrantPulse();
        return;
      }
      const current = readLease();
      if (
        !current ||
        current.leaseId !== leaseId ||
        current.owner !== tabId ||
        current.phase !== 'done' ||
        current.until <= now()
      ) {
        stopGrantPulse();
        return;
      }
      publishGrant(announced);
    };
    grantPulse = setInterval(tick, 50);
  }

  function lostDegradedRace(): boolean {
    for (const [peerId, peer] of degradedPeers) {
      if (peerId === tabId) {
        continue;
      }
      if (peer.at < degradedAt || (peer.at === degradedAt && peerId < tabId)) {
        return true;
      }
    }
    return false;
  }

  function amFirstDoneWaiter(leaseId: string, at: number): boolean {
    let bestAt = at;
    let bestId = tabId;
    const prefix = `${leaseId}:`;
    for (const [key, waiter] of doneWaiters) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      if (waiter.at < bestAt || (waiter.at === bestAt && waiter.tabId < bestId)) {
        bestAt = waiter.at;
        bestId = waiter.tabId;
      }
    }
    return bestId === tabId;
  }

  function resetDegraded(): void {
    stopDegradedReply();
    stopDegradedPulse();
    degradedAt = 0;
    degradedCoordinator = false;
    degradedCommitted = false;
    degradedInbox = null;
    degradedPeers.clear();
    doneWaiters.clear();
  }

  function discardMemory(): void {
    life += 1;
    stopHeartbeat();
    stopGrantPulse();
    announced = null;
    memoryGrants.clear();
    queuedPlease.clear();
    answeredPlease.clear();
    pleaseIds.clear();
    consumed.clear();
    dispatched.clear();
    resetDegraded();
    wakeAll();
  }

  function inspect(): Inspect {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(SESSION_LEASE_KEY);
    } catch {
      return { kind: 'broken' };
    }
    if (!raw) {
      return { kind: 'empty', nextEpoch: 0 };
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return { kind: 'invalid', nextEpoch: 0 };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { kind: 'invalid', nextEpoch: 0 };
    }
    const record = data as Record<string, unknown>;
    const epochRaw = record.epoch;
    const untilRaw = record.until;
    const leaseIdRaw = record.leaseId;
    const ownerRaw = record.owner;
    const phaseRaw = record.phase;
    let nextEpoch = 0;
    if (
      typeof epochRaw === 'number' &&
      Number.isInteger(epochRaw) &&
      epochRaw >= 0 &&
      epochRaw <= Number.MAX_SAFE_INTEGER
    ) {
      nextEpoch = epochRaw;
    }
    const keys = Object.keys(record);
    if (keys.length !== LEASE_KEYS.length || LEASE_KEYS.some((key) => !keys.includes(key))) {
      return { kind: 'invalid', nextEpoch };
    }
    const phaseOk = phaseRaw === 'open' || phaseRaw === 'sending' || phaseRaw === 'done';
    const leaseIdOk = typeof leaseIdRaw === 'string' && leaseIdRaw.length > 0;
    const ownerOk = typeof ownerRaw === 'string' && ownerRaw.length > 0;
    const untilOk = typeof untilRaw === 'number' && Number.isFinite(untilRaw);
    if (!phaseOk || !leaseIdOk || !ownerOk || !untilOk || nextEpoch !== epochRaw) {
      return { kind: 'invalid', nextEpoch };
    }
    if (untilRaw > untilCeiling(now())) {
      return { kind: 'invalid', nextEpoch };
    }
    return {
      kind: 'lease',
      nextEpoch,
      lease: {
        leaseId: leaseIdRaw,
        epoch: nextEpoch,
        owner: ownerRaw,
        until: untilRaw,
        phase: phaseRaw,
      },
    };
  }

  function readLease(): SessionLease | null {
    const found = inspect();
    return found.kind === 'lease' ? found.lease : null;
  }

  function writeLease(lease: SessionLease): boolean {
    const payload = JSON.stringify({
      leaseId: lease.leaseId,
      epoch: lease.epoch,
      owner: lease.owner,
      until: lease.until,
      phase: lease.phase,
    });
    try {
      window.localStorage.setItem(SESSION_LEASE_KEY, payload);
    } catch {
      return false;
    }
    wakeAll();
    return true;
  }

  function startHeartbeat(leaseId: string, myLife: number): void {
    stopHeartbeat();
    const tick = () => {
      if (myLife !== life || isLoggedOutFlag()) {
        stopHeartbeat();
        return;
      }
      const current = readLease();
      if (
        !current ||
        current.leaseId !== leaseId ||
        current.owner !== tabId ||
        current.phase !== 'sending'
      ) {
        stopHeartbeat();
        return;
      }
      writeLease({ ...current, until: now() + LEASE_OPEN_MS });
    };
    beatTimer = setInterval(tick, HEARTBEAT_MS);
  }

  function ensureChannel(): ChannelLike | null {
    if (channelOpened) {
      return channel;
    }
    channelOpened = true;
    channel = createChannel();
    if (!channel) {
      return null;
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as WireMessage | null;
      if (!data || data.v !== 1) {
        return;
      }
      if (data.type === 'grant' && typeof data.leaseId === 'string' && typeof data.token === 'string') {
        if (isLoggedOutFlag() || !data.token.trim()) {
          return;
        }
        const expiresIn =
          typeof data.expiresIn === 'number' && Number.isFinite(data.expiresIn)
            ? data.expiresIn
            : null;
        if (data.leaseId === DEGRADED_LEASE_ID) {
          if (inspect().kind !== 'broken') {
            return;
          }
          degradedInbox = { token: data.token, expiresIn };
          wakeAll();
          return;
        }
        // Guarda mesmo se o done ainda não apareceu nesta aba. No WebKit o
        // canal pode chegar antes do localStorage, e descartar o grant faz
        // o ping abrir um epoch novo.
        memoryGrants.set(data.leaseId, { token: data.token, expiresIn });
        wakeAll();
        return;
      }
      if (
        (data.type === 'degraded-claim' || data.type === 'degraded-commit') &&
        typeof data.tabId === 'string' &&
        data.tabId &&
        typeof data.at === 'number' &&
        Number.isFinite(data.at)
      ) {
        const previous = degradedPeers.get(data.tabId);
        degradedPeers.set(data.tabId, {
          at: data.at,
          commit: data.type === 'degraded-commit' || previous?.commit === true,
        });
        if (degradedCoordinator && data.tabId !== tabId) {
          scheduleDegradedReply();
        }
        wakeAll();
        return;
      }
      if (
        data.type === 'done-wait' &&
        typeof data.tabId === 'string' &&
        data.tabId &&
        typeof data.leaseId === 'string' &&
        data.leaseId &&
        typeof data.at === 'number' &&
        Number.isFinite(data.at)
      ) {
        doneWaiters.set(`${data.leaseId}:${data.tabId}`, { tabId: data.tabId, at: data.at });
        if (announced && announced.leaseId === data.leaseId) {
          publishGrant(announced);
        }
        wakeAll();
        return;
      }
      if (
        data.type === 'grant-please' &&
        typeof data.id === 'string' &&
        typeof data.leaseId === 'string'
      ) {
        notePlease(data.id, data.leaseId);
        return;
      }
      if (data.type === 'logout') {
        announced = null;
        memoryGrants.clear();
        stopGrantPulse();
        resetDegraded();
        emit({ type: 'logout' });
        return;
      }
      if (data.type === 'session-expired') {
        announced = null;
        memoryGrants.clear();
        stopGrantPulse();
        resetDegraded();
        emit({ type: 'session-expired' });
      }
    };
    channel.addEventListener('message', onMessage);
    return channel;
  }

  function publish(message: WireMessage): void {
    if (
      isLoggedOutFlag() &&
      message.type !== 'logout' &&
      message.type !== 'session-expired'
    ) {
      return;
    }
    try {
      ensureChannel()?.postMessage(message);
    } catch {
      // Canal já fechado.
    }
  }

  function publishGrant(grant: Announced): void {
    if (isLoggedOutFlag()) {
      return;
    }
    const current = readLease();
    if (!current || current.leaseId !== grant.leaseId || current.owner !== tabId || current.phase !== 'done') {
      return;
    }
    publish({
      v: 1,
      type: 'grant',
      leaseId: grant.leaseId,
      token: grant.token,
      expiresIn: grant.expiresIn,
    });
  }

  function replyPlease(id: string): void {
    if (!id || answeredPlease.has(id) || !announced || isLoggedOutFlag()) {
      return;
    }
    const current = readLease();
    if (
      !current ||
      current.phase !== 'done' ||
      current.leaseId !== announced.leaseId ||
      current.owner !== tabId
    ) {
      return;
    }
    answeredPlease.add(id);
    queuedPlease.delete(id);
    publishGrant(announced);
  }

  function notePlease(id: string, leaseId: string): void {
    if (!id || answeredPlease.has(id) || isLoggedOutFlag()) {
      return;
    }
    const current = readLease();
    if (!current || current.owner !== tabId || current.leaseId !== leaseId) {
      return;
    }
    if (announced && announced.leaseId === leaseId && current.phase === 'done') {
      replyPlease(id);
      return;
    }
    if (postingLeaseId === leaseId) {
      queuedPlease.set(id, leaseId);
    }
  }

  function flushPlease(): void {
    if (!announced) {
      return;
    }
    for (const [id, leaseId] of [...queuedPlease]) {
      if (leaseId === announced.leaseId) {
        replyPlease(id);
      }
    }
  }

  function pleaseIdFor(leaseId: string): string {
    const existing = pleaseIds.get(leaseId);
    if (existing) {
      return existing;
    }
    const id = newLeaseId();
    pleaseIds.set(leaseId, id);
    return id;
  }

  function takeDegradedGrant(): AccessGrant | null {
    if (!degradedInbox) {
      return null;
    }
    if (isLoggedOutFlag() || inspect().kind !== 'broken') {
      degradedInbox = null;
      return null;
    }
    const found = degradedInbox;
    degradedInbox = null;
    return { accessToken: found.token, expiresIn: found.expiresIn };
  }

  function publishDegradedGrant(grant: AccessGrant): void {
    if (isLoggedOutFlag()) {
      return;
    }
    publish({
      v: 1,
      type: 'grant',
      leaseId: DEGRADED_LEASE_ID,
      token: grant.accessToken,
      expiresIn: grant.expiresIn,
    });
  }

  function takeGrant(leaseId: string): AccessGrant | null {
    const found = memoryGrants.get(leaseId);
    if (!found) {
      return null;
    }
    if (isLoggedOutFlag()) {
      memoryGrants.delete(leaseId);
      return null;
    }
    const current = readLease();
    if (!current || current.leaseId !== leaseId) {
      return null;
    }
    memoryGrants.delete(leaseId);
    consumed.add(leaseId);
    return { accessToken: found.token, expiresIn: found.expiresIn };
  }

  function interruptible(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(finish, Math.max(0, ms));
      const wake = () => finish();
      wakes.add(wake);
      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        wakes.delete(wake);
        resolve();
      }
    });
  }

  async function waitOpen(lease: SessionLease, myLife: number): Promise<void> {
    while (myLife === life) {
      const current = readLease();
      if (!current || current.leaseId !== lease.leaseId || current.phase !== 'open' || current.until <= now()) {
        return;
      }
      await interruptible(current.until - now());
    }
  }

  async function waitGrant(
    lease: SessionLease,
    myLife: number,
    pingMs?: number,
  ): Promise<AccessGrant | null> {
    if (!channel) {
      return null;
    }
    const pingDeadline = pingMs == null ? null : now() + Math.max(0, pingMs);
    const waitedAt = now();
    if (pingMs != null) {
      doneWaiters.set(`${lease.leaseId}:${tabId}`, { tabId, at: waitedAt });
    } else {
      publish({
        v: 1,
        type: 'grant-please',
        id: pleaseIdFor(lease.leaseId),
        leaseId: lease.leaseId,
      });
    }
    let nextAnnounce = 0;
    while (myLife === life) {
      if (isLoggedOutFlag()) {
        return null;
      }
      const grant = takeGrant(lease.leaseId);
      if (grant) {
        return grant;
      }
      const current = readLease();
      if (!current || current.leaseId !== lease.leaseId || current.phase === 'open') {
        return null;
      }
      if (pingMs != null && now() >= nextAnnounce) {
        publish({ v: 1, type: 'done-wait', tabId, at: waitedAt, leaseId: lease.leaseId });
        publish({
          v: 1,
          type: 'grant-please',
          id: newLeaseId(),
          leaseId: lease.leaseId,
        });
        nextAnnounce = now() + 50;
      }
      const cap = pingDeadline == null ? current.until : Math.min(current.until, pingDeadline);
      const remaining = cap - now();
      if (remaining <= 0) {
        if (pingMs == null) {
          return null;
        }
        await drainMessages();
        return takeGrant(lease.leaseId);
      }
      await interruptible(pingMs == null ? remaining : Math.min(remaining, 50));
    }
    return null;
  }

  function failPost(): void {
    stopHeartbeat();
    stopGrantPulse();
    announced = null;
  }

  function finishPost(leaseId: string | null, myLife: number, grant: AccessGrant): AccessGrant {
    stopHeartbeat();
    if (myLife !== life || isLoggedOutFlag()) {
      throw new SessionExpiredError(false);
    }
    if (!leaseId) {
      return grant;
    }
    const current = readLease();
    if (!current || current.leaseId !== leaseId || current.owner !== tabId) {
      throw new SessionExpiredError(false);
    }
    const done: SessionLease = {
      leaseId,
      epoch: current.epoch,
      owner: tabId,
      until: now() + LEASE_DONE_MS,
      phase: 'done',
    };
    if (!writeLease(done)) {
      return grant;
    }
    if (myLife !== life || isLoggedOutFlag()) {
      throw new SessionExpiredError(false);
    }
    const fresh = readLease();
    if (!fresh || fresh.leaseId !== leaseId || fresh.owner !== tabId || fresh.phase !== 'done') {
      throw new SessionExpiredError(false);
    }
    consumed.add(leaseId);
    announced = {
      leaseId,
      token: grant.accessToken,
      expiresIn: grant.expiresIn,
    };
    publishGrant(announced);
    flushPlease();
    startGrantPulse(leaseId, myLife);
    return grant;
  }

  function beginPost(leaseId: string | null, myLife: number): Promise<AccessGrant> {
    postingLeaseId = leaseId;
    if (leaseId) {
      dispatched.add(leaseId);
      startHeartbeat(leaseId, myLife);
    }
    const pending = postRefresh().then(
      (grant) => finishPost(leaseId, myLife, grant),
      (error: unknown) => {
        failPost();
        throw error;
      },
    );
    const tracked = pending.finally(() => {
      if (postInFlight === tracked) {
        postInFlight = null;
      }
      if (postingLeaseId === leaseId) {
        postingLeaseId = null;
      }
    });
    postInFlight = tracked;
    return tracked;
  }

  /**
   * Releitura, phase sending e o fetch no mesmo trecho síncrono.
   * Não há await entre os três.
   */
  function promote(expected: SessionLease, myLife: number): Promise<AccessGrant> | null {
    if (myLife !== life || isLoggedOutFlag()) {
      return null;
    }
    const current = readLease();
    if (
      !current ||
      current.leaseId !== expected.leaseId ||
      current.owner !== tabId ||
      current.phase !== 'open'
    ) {
      return null;
    }
    const sending: SessionLease = {
      leaseId: current.leaseId,
      epoch: current.epoch,
      owner: tabId,
      until: now() + LEASE_OPEN_MS,
      phase: 'sending',
    };
    if (!writeLease(sending)) {
      return null;
    }
    return beginPost(sending.leaseId, myLife);
  }

  async function jitterThenPromote(
    lease: SessionLease,
    myLife: number,
  ): Promise<{ pending: Promise<AccessGrant> | null }> {
    await sleep(nextJitter());
    if (myLife !== life || isLoggedOutFlag()) {
      throw new SessionExpiredError(false);
    }
    // Caixa o POST. Devolver a promise direto faria o async aguardar o
    // fetch e seguraria o Web Lock até o fim do POST.
    return { pending: promote(lease, myLife) };
  }

  function startDegradedPulse(grant: AccessGrant, myLife: number): void {
    stopDegradedPulse();
    const deadline = now() + LEASE_OPEN_MS;
    publishDegradedGrant(grant);
    degradedPulse = setInterval(() => {
      if (myLife !== life || isLoggedOutFlag() || now() >= deadline) {
        stopDegradedPulse();
        return;
      }
      publishDegradedGrant(grant);
    }, 50);
  }

  async function waitDegradedGrant(myLife: number): Promise<Outcome> {
    const deadline = now() + LEASE_OPEN_MS;
    while (now() < deadline) {
      if (myLife !== life || isLoggedOutFlag()) {
        throw new SessionExpiredError(false);
      }
      const reused = takeDegradedGrant();
      if (reused) {
        return { kind: 'grant', grant: reused };
      }
      await interruptible(Math.min(50, Math.max(0, deadline - now())));
    }
    const last = takeDegradedGrant();
    if (last && myLife === life && !isLoggedOutFlag()) {
      return { kind: 'grant', grant: last };
    }
    throw new SessionExpiredError(false);
  }

  async function electDegradedCoordinator(myLife: number): Promise<'coordinate' | 'wait' | AccessGrant> {
    degradedAt = now();
    degradedCommitted = false;
    degradedPeers.set(tabId, { at: degradedAt, commit: false });
    const deadline = degradedAt + GRANT_OWNER_PING_MS;
    const commitAt = deadline - 50;
    while (now() < deadline) {
      if (myLife !== life || isLoggedOutFlag()) {
        throw new SessionExpiredError(false);
      }
      const reused = takeDegradedGrant();
      if (reused) {
        return reused;
      }
      if (lostDegradedRace()) {
        return 'wait';
      }
      if (!degradedCommitted && now() >= commitAt) {
        degradedCommitted = true;
        degradedPeers.set(tabId, { at: degradedAt, commit: true });
        publish({ v: 1, type: 'degraded-commit', tabId, at: degradedAt });
      } else {
        publish({ v: 1, type: 'degraded-claim', tabId, at: degradedAt });
      }
      await interruptible(Math.min(50, Math.max(0, deadline - now())));
    }
    const trailing = takeDegradedGrant();
    if (trailing) {
      return trailing;
    }
    return lostDegradedRace() ? 'wait' : 'coordinate';
  }

  /**
   * Storage ilegível. Com Web Lock o POST termina antes de soltar o lock
   * e o grant segue no canal até L. Sem lock, a primeira aba faz um POST
   * e a perdedora espera esse grant até L, sem POST.
   */
  async function runDegraded(myLife: number): Promise<Outcome> {
    if (myLife !== life || isLoggedOutFlag()) {
      throw new SessionExpiredError(false);
    }
    if (locks) {
      const grace = now() + 50;
      while (now() < grace) {
        const reused = takeDegradedGrant();
        if (reused) {
          return { kind: 'grant', grant: reused };
        }
        await interruptible(Math.min(50, Math.max(0, grace - now())));
        if (myLife !== life || isLoggedOutFlag()) {
          throw new SessionExpiredError(false);
        }
      }
      const grant = await beginPost(null, myLife);
      const deadline = now() + GRANT_OWNER_PING_MS;
      while (now() < deadline) {
        if (myLife !== life || isLoggedOutFlag()) {
          break;
        }
        publishDegradedGrant(grant);
        await interruptible(Math.min(50, Math.max(0, deadline - now())));
      }
      if (myLife !== life || isLoggedOutFlag()) {
        throw new SessionExpiredError(false);
      }
      startDegradedPulse(grant, myLife);
      return { kind: 'grant', grant };
    }
    const election = await electDegradedCoordinator(myLife);
    if (election !== 'coordinate' && election !== 'wait') {
      return { kind: 'grant', grant: election };
    }
    if (election === 'wait' || lostDegradedRace()) {
      return waitDegradedGrant(myLife);
    }
    degradedCoordinator = true;
    const grant = await beginPost(null, myLife);
    startDegradedPulse(grant, myLife);
    return { kind: 'grant', grant };
  }

  async function acquire(myLife: number): Promise<Outcome> {
    let spins = 0;
    while (myLife === life) {
      spins += 1;
      if (spins > 12) {
        throw new SessionExpiredError(false);
      }
      if (isLoggedOutFlag()) {
        throw new SessionExpiredError(false);
      }
      const found = inspect();
      if (found.kind === 'broken') {
        return runDegraded(myLife);
      }
      if (found.kind === 'lease' && found.lease.phase === 'sending') {
        if (
          postInFlight &&
          postingLeaseId === found.lease.leaseId &&
          found.lease.owner === tabId
        ) {
          return { kind: 'detached', pending: postInFlight };
        }
        if (!channel || found.lease.until <= now()) {
          throw new SessionExpiredError(false);
        }
        const grant = await waitGrant(found.lease, myLife);
        if (myLife !== life || isLoggedOutFlag()) {
          throw new SessionExpiredError(false);
        }
        if (!grant) {
          throw new SessionExpiredError(false);
        }
        return { kind: 'grant', grant };
      }
      if (
        found.kind === 'lease' &&
        found.lease.phase === 'done' &&
        found.lease.until > now() &&
        !consumed.has(found.lease.leaseId)
      ) {
        // done só existe depois de um POST bem-sucedido: o cookie antigo
        // já foi rotacionado e a aba nova tem o cookie novo. O ping confirma
        // se o dono ainda está vivo. Sem canal não há ping: falha fechado.
        // Sem resposta, este leaseId não gera POST; o epoch seguinte gera um.
        if (!channel) {
          throw new SessionExpiredError(false);
        }
        const grant = await waitGrant(found.lease, myLife, GRANT_OWNER_PING_MS);
        if (myLife !== life || isLoggedOutFlag()) {
          throw new SessionExpiredError(false);
        }
        if (grant) {
          return { kind: 'grant', grant };
        }
        // O ping não abre POST. O done ainda vale e o dono vivo pode entregar
        // o grant depois dos 400 ms. O epoch novo espera o done vencer: um
        // POST sequencial, no cookie que já foi rotacionado.
        const deadline = found.lease.until;
        while (myLife === life && now() < deadline) {
          const during = takeGrant(found.lease.leaseId);
          if (during) {
            return { kind: 'grant', grant: during };
          }
          const current = readLease();
          if (!current || current.leaseId !== found.lease.leaseId) {
            break;
          }
          if (isLoggedOutFlag()) {
            throw new SessionExpiredError(false);
          }
          await interruptible(Math.min(50, Math.max(0, deadline - now())));
        }
        if (myLife !== life || isLoggedOutFlag()) {
          throw new SessionExpiredError(false);
        }
        const late = takeGrant(found.lease.leaseId);
        if (late) {
          return { kind: 'grant', grant: late };
        }
        const moved = readLease();
        if (moved && moved.leaseId !== found.lease.leaseId) {
          continue;
        }
        const waited = doneWaiters.get(`${found.lease.leaseId}:${tabId}`);
        const waitedAt = waited?.at ?? now();
        if (!amFirstDoneWaiter(found.lease.leaseId, waitedAt)) {
          await interruptible(50);
          continue;
        }
        consumed.add(found.lease.leaseId);
        continue;
      }
      if (
        found.kind === 'lease' &&
        found.lease.phase === 'open' &&
        found.lease.until > now() &&
        found.lease.owner !== tabId
      ) {
        await waitOpen(found.lease, myLife);
        continue;
      }
      if (
        found.kind === 'lease' &&
        found.lease.phase === 'open' &&
        found.lease.until > now() &&
        found.lease.owner === tabId
      ) {
        const promoted = await jitterThenPromote(found.lease, myLife);
        if (promoted.pending) {
          return { kind: 'detached', pending: promoted.pending };
        }
        continue;
      }
      const epoch = found.kind === 'lease' ? found.lease.epoch : found.nextEpoch;
      let minted: SessionLease;
      try {
        minted = {
          leaseId: newLeaseId(),
          epoch: epoch + 1,
          owner: tabId,
          until: now() + LEASE_OPEN_MS,
          phase: 'open',
        };
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          throw error;
        }
        throw new SessionExpiredError(false);
      }
      const replacingId = found.kind === 'lease' ? found.lease.leaseId : null;
      const live = readLease();
      if (live && live.until > now() && live.leaseId !== replacingId) {
        continue;
      }
      if (replacingId && live && live.phase === 'done' && live.leaseId === replacingId) {
        await drainMessages();
        const late = takeGrant(replacingId);
        if (late) {
          return { kind: 'grant', grant: late };
        }
        const again = readLease();
        if (again && again.until > now() && again.leaseId !== replacingId) {
          continue;
        }
      }
      if (!writeLease(minted)) {
        if (inspect().kind === 'broken') {
          return runDegraded(myLife);
        }
        throw new SessionExpiredError(false);
      }
      const promoted = await jitterThenPromote(minted, myLife);
      if (promoted.pending) {
        return { kind: 'detached', pending: promoted.pending };
      }
    }
    throw new SessionExpiredError(false);
  }

  async function refreshExclusive(): Promise<AccessGrant> {
    if (postInFlight) {
      try {
        await postInFlight;
      } catch {
        // O POST anterior foi descartado ou falhou. Só então um lease novo.
      }
    }
    if (isLoggedOutFlag()) {
      throw new SessionExpiredError(false);
    }
    ensureStorageListener();
    ensureChannel();
    const myLife = life;
    const run = () => acquire(myLife);
    const outcome = locks ? await locks.request(REFRESH_LOCK_NAME, run) : await run();
    if (outcome.kind === 'detached') {
      if (myLife !== life || isLoggedOutFlag()) {
        return outcome.pending.then(() => {
          throw new SessionExpiredError(false);
        });
      }
      return outcome.pending;
    }
    if (myLife !== life || isLoggedOutFlag()) {
      throw new SessionExpiredError(false);
    }
    return outcome.grant;
  }

  function onStorage(event: StorageEvent): void {
    if (event.key === LOGGED_OUT_KEY) {
      if (event.newValue === LOGGED_OUT_VALUE) {
        stopHeartbeat();
        stopGrantPulse();
        announced = null;
        memoryGrants.clear();
        queuedPlease.clear();
        resetDegraded();
      }
      wakeAll();
      return;
    }
    if (event.key === SESSION_LEASE_KEY || event.key === null) {
      wakeAll();
    }
  }

  function releaseOwnDone(): void {
    // Com canal o ping elege uma sucessora. Apagar o done no reload
    // faz as abas mintarem juntas e a segunda pode passar do fetch.
    if (channel) {
      return;
    }
    const current = readLease();
    if (!current || current.phase !== 'done' || current.owner !== tabId) {
      return;
    }
    const owns =
      (announced != null && announced.leaseId === current.leaseId) ||
      consumed.has(current.leaseId);
    if (!owns) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(SESSION_LEASE_KEY);
      if (!raw) {
        return;
      }
      const again = JSON.parse(raw) as Partial<SessionLease>;
      if (again.phase !== 'done' || again.owner !== tabId || again.leaseId !== current.leaseId) {
        return;
      }
      window.localStorage.removeItem(SESSION_LEASE_KEY);
    } catch {
      // Storage bloqueado: não há done para apagar.
    }
  }

  function releaseUnsentClaim(): void {
    const current = readLease();
    if (!current || current.owner !== tabId) {
      return;
    }
    if (current.phase !== 'open' && current.phase !== 'sending') {
      return;
    }
    if (dispatched.has(current.leaseId)) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(SESSION_LEASE_KEY);
      if (!raw) {
        return;
      }
      const again = JSON.parse(raw) as Partial<SessionLease>;
      if (
        again.owner !== tabId ||
        again.leaseId !== current.leaseId ||
        (again.phase !== 'open' && again.phase !== 'sending')
      ) {
        return;
      }
      if (dispatched.has(current.leaseId)) {
        return;
      }
      window.localStorage.removeItem(SESSION_LEASE_KEY);
    } catch {
      // Storage bloqueado: não há lease para apagar.
    }
  }

  function onPageHide(): void {
    releaseUnsentClaim();
    releaseOwnDone();
  }

  function bindPageHide(): void {
    if (pageHideBound || typeof window === 'undefined') {
      return;
    }
    pageHideBound = true;
    window.addEventListener('pagehide', onPageHide);
  }

  function unbindPageHide(): void {
    if (!pageHideBound || typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('pagehide', onPageHide);
    pageHideBound = false;
  }

  function ensureStorageListener(): void {
    if (storageBound || typeof window === 'undefined') {
      return;
    }
    storageBound = true;
    window.addEventListener('storage', onStorage);
  }

  function unbindStorage(): void {
    if (!storageBound || typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('storage', onStorage);
    storageBound = false;
  }

  bindPageHide();

  const cleaner = () => {
    discardMemory();
  };
  sessionCleaners.add(cleaner);

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
      sessionCleaners.delete(cleaner);
      discardMemory();
      inflight = null;
      unbindStorage();
      unbindPageHide();
      try {
        channel?.close();
      } catch {
        // Canal já fechado.
      }
      channel = null;
      channelOpened = false;
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

/** Login e logout apagam o lease e param o batimento. Não recria a chave. */
export function clearSessionRefreshMark(): void {
  for (const clean of [...sessionCleaners]) {
    clean();
  }
  try {
    window.localStorage.removeItem(SESSION_LEASE_KEY);
  } catch {
    // Sem storage, não há lease para apagar.
  }
  try {
    window.localStorage.removeItem(LEGACY_MARK_KEY);
  } catch {
    // Marca antiga ausente.
  }
}

export function resetSessionRuntimeForTests(): void {
  restoreFlight = null;
  singleton?.reset();
  singleton = null;
  refreshImpl = async () => {
    throw new SessionExpiredError();
  };
  try {
    window.localStorage.removeItem(SESSION_LEASE_KEY);
  } catch {
    // jsdom sem storage.
  }
  try {
    window.localStorage.removeItem(LEGACY_MARK_KEY);
  } catch {
    // jsdom sem storage.
  }
}

export async function refreshWithApi(
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
): Promise<AccessGrant> {
  return requestRefresh(apiBaseUrl, fetchImpl);
}
