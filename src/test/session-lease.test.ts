import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionExpiredError } from '../api/sessionHttp';
import { clearLoggedOutFlag, markLoggedOut } from '../auth/loggedOut';
import {
  clearSessionRefreshMark,
  createSessionCoordinator,
  LEASE_DONE_MS,
  LEASE_JITTER_MAX_MS,
  LEASE_OPEN_MS,
  SESSION_LEASE_KEY,
  type SessionCoordinator,
  type SessionLease,
} from '../auth/sessionRefresh';

type Wire = {
  v: 1;
  type: string;
  token?: string;
  leaseId?: string;
  id?: string;
  expiresIn?: number | null;
};

function createBus() {
  const handlers = new Set<(data: Wire) => void>();
  return {
    channel() {
      const mine = new Set<(data: Wire) => void>();
      return {
        postMessage(data: Wire) {
          for (const handler of handlers) {
            if (!mine.has(handler)) {
              handler(data);
            }
          }
        },
        addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
          const handler = (data: Wire) => listener({ data } as MessageEvent);
          mine.add(handler);
          handlers.add(handler);
        },
        removeEventListener() {},
        close() {
          for (const handler of mine) {
            handlers.delete(handler);
          }
        },
      };
    },
  };
}

function sharedLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request(_name: string, callback: () => Promise<unknown>) {
      const run = tail.then(() => callback());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function seed(lease: SessionLease): void {
  window.localStorage.setItem(SESSION_LEASE_KEY, JSON.stringify(lease));
}

function readLease(): SessionLease | null {
  const raw = window.localStorage.getItem(SESSION_LEASE_KEY);
  return raw ? (JSON.parse(raw) as SessionLease) : null;
}

function tab(
  locks: LockManager | null,
  postRefresh: () => Promise<{ accessToken: string; expiresIn: number | null }>,
  channel: ReturnType<typeof createBus> | null,
): SessionCoordinator {
  return createSessionCoordinator({
    locks,
    createChannel: channel ? () => channel.channel() : () => null,
    postRefresh,
  });
}

async function flushJitter(): Promise<void> {
  await vi.advanceTimersByTimeAsync(LEASE_JITTER_MAX_MS);
}

describe('lease único do refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    clearLoggedOutFlag();
    window.localStorage.removeItem(SESSION_LEASE_KEY);
    window.localStorage.removeItem('mae.sessionRefresh');
  });

  it('o fuso do processo é America/Sao_Paulo', () => {
    expect(process.env.TZ).toBe('America/Sao_Paulo');
  });

  it.each([
    ['com locks', true],
    ['sem locks', false],
  ])('%s: marca órfã open no boot faz 1 POST depois do until', async (_label, withLocks) => {
    vi.useFakeTimers();
    seed({
      leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      epoch: 3,
      owner: 'aba-morta',
      until: Date.now() + 1_000,
      phase: 'open',
    });
    let posts = 0;
    const locks = withLocks ? (sharedLocks() as unknown as LockManager) : null;
    const bus = createBus();
    const coordinators = [0, 1].map(() =>
      tab(locks, async () => {
        posts += 1;
        const during = window.localStorage.getItem(SESSION_LEASE_KEY) ?? '';
        expect(during).not.toMatch(/jwt|accessToken|access_token/);
        return { accessToken: 'jwt-orfa', expiresIn: 90 };
      }, bus),
    );
    const pending = Promise.all(coordinators.map((item) => item.refresh()));
    await vi.advanceTimersByTimeAsync(999);
    expect(posts).toBe(0);
    await vi.advanceTimersByTimeAsync(1 + LEASE_JITTER_MAX_MS + 20);
    const grants = await pending;
    expect(posts).toBe(1);
    expect(grants.map((grant) => grant.accessToken)).toEqual(['jwt-orfa', 'jwt-orfa']);
    const stored = readLease();
    expect(stored?.phase).toBe('done');
    expect(stored?.epoch).toBe(4);
    expect(JSON.stringify(stored)).not.toMatch(/jwt/);
  });

  it.each([
    ['com locks', true],
    ['sem locks', false],
  ])('%s: líder morto antes do envio libera um epoch e 1 POST', async (_label, withLocks) => {
    vi.useFakeTimers();
    const locks = withLocks ? (sharedLocks() as unknown as LockManager) : null;
    const bus = createBus();
    let posts = 0;
    const post = async () => {
      posts += 1;
      return { accessToken: 'jwt-retomada', expiresIn: 30 };
    };
    const leader = tab(locks, post, bus);
    const survivor = tab(locks, post, bus);
    const leaderResult = leader.refresh().then(
      () => 'ok',
      () => 'fail',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toBe(0);
    expect(readLease()?.phase).toBe('open');
    leader.reset();
    const survivorResult = survivor.refresh();
    await flushJitter();
    expect(posts).toBe(0);
    await vi.advanceTimersByTimeAsync(LEASE_OPEN_MS + LEASE_JITTER_MAX_MS + 30);
    const grant = await survivorResult;
    expect(grant.accessToken).toBe('jwt-retomada');
    expect(posts).toBe(1);
    expect(await leaderResult).toBe('fail');
  });

  it.each([
    ['com locks', true],
    ['sem locks', false],
  ])('%s: dono morto após o fetch não gera POST extra', async (_label, withLocks) => {
    vi.useFakeTimers();
    const locks = withLocks ? (sharedLocks() as unknown as LockManager) : null;
    const bus = createBus();
    let posts = 0;
    const leader = tab(
      locks,
      () => {
        posts += 1;
        return new Promise(() => {});
      },
      bus,
    );
    const survivor = tab(
      locks,
      async () => {
        posts += 1;
        throw new SessionExpiredError(true);
      },
      bus,
    );
    const leaderResult = leader.refresh().then(
      () => 'ok',
      () => 'fail',
    );
    await flushJitter();
    expect(posts).toBe(1);
    expect(readLease()?.phase).toBe('sending');
    leader.reset();
    const survivorResult = survivor.refresh().then(
      () => 'ok',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(LEASE_OPEN_MS - 1);
    expect(posts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await survivorResult;
    expect(error).toBeInstanceOf(SessionExpiredError);
    expect((error as SessionExpiredError).confirmed).toBe(false);
    expect(posts).toBe(1);
    expect(JSON.stringify(readLease())).not.toMatch(/jwt|accessToken/);
    void leaderResult;
  });

  it.each([
    ['com locks', true],
    ['sem locks', false],
  ])('%s: F5 com 2, 3 e 4 abas faz 1 POST', async (_label, withLocks) => {
    vi.useFakeTimers();
    for (const count of [2, 3, 4]) {
      window.localStorage.removeItem(SESSION_LEASE_KEY);
      const locks = withLocks ? (sharedLocks() as unknown as LockManager) : null;
      const bus = createBus();
      let posts = 0;
      const tabs = Array.from({ length: count }, () =>
        tab(locks, async () => {
          posts += 1;
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { accessToken: `jwt-f5-${count}`, expiresIn: 90 };
        }, bus),
      );
      const pending = Promise.all(tabs.map((item) => item.refresh()));
      await vi.advanceTimersByTimeAsync(LEASE_JITTER_MAX_MS + 80);
      const grants = await pending;
      expect(posts, `${count} abas`).toBe(1);
      expect(grants.every((grant) => grant.accessToken === `jwt-f5-${count}`)).toBe(true);
      expect(JSON.stringify(readLease())).not.toMatch(/jwt/);
    }
  });

  it.each([
    ['com locks', true],
    ['sem locks', false],
  ])('%s: POST acima de 5s renova o until e a seguidora não faz outro POST', async (_label, withLocks) => {
    vi.useFakeTimers();
    const locks = withLocks ? (sharedLocks() as unknown as LockManager) : null;
    const bus = createBus();
    let posts = 0;
    const slowMs = 5_500;
    const tabs = [0, 1].map(() =>
      tab(locks, async () => {
        posts += 1;
        await new Promise((resolve) => setTimeout(resolve, slowMs));
        return { accessToken: 'jwt-lento', expiresIn: 120 };
      }, bus),
    );
    const pending = Promise.all(tabs.map((item) => item.refresh()));
    await vi.advanceTimersByTimeAsync(LEASE_OPEN_MS);
    expect(posts).toBe(1);
    expect(readLease()?.phase).toBe('sending');
    expect(readLease()?.until ?? 0).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(slowMs - LEASE_OPEN_MS + LEASE_JITTER_MAX_MS + 50);
    const grants = await pending;
    expect(posts).toBe(1);
    expect(grants.map((grant) => grant.accessToken)).toEqual(['jwt-lento', 'jwt-lento']);
    expect(readLease()?.phase).toBe('done');
    expect(JSON.stringify(readLease())).not.toMatch(/jwt|accessToken/);
  });

  it.each([
    ['com locks', true],
    ['sem locks', false],
  ])('%s: logout e login durante POST lento não gravam done nem grant velho', async (_label, withLocks) => {
    vi.useFakeTimers();
    const locks = withLocks ? (sharedLocks() as unknown as LockManager) : null;
    const bus = createBus();
    const seen: Wire[] = [];
    const tap = bus.channel();
    tap.addEventListener('message', (event) => {
      seen.push(event.data as Wire);
    });
    let release: (grant: { accessToken: string; expiresIn: number | null }) => void = () => {};
    let posts = 0;
    const current = tab(
      locks,
      () => {
        posts += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      bus,
    );
    const pending = current.refresh().then(
      () => 'ok',
      () => 'fail',
    );
    await flushJitter();
    expect(posts).toBe(1);
    expect(readLease()?.phase).toBe('sending');
    markLoggedOut();
    clearSessionRefreshMark();
    current.reset();
    clearLoggedOutFlag();
    release({ accessToken: 'jwt-velho', expiresIn: 90 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toBe('fail');
    expect(readLease()).toBeNull();
    expect(seen.filter((message) => message.type === 'grant')).toEqual([]);
    expect(JSON.stringify(window.localStorage)).not.toMatch(/jwt-velho/);

    const next = tab(locks, async () => {
      posts += 1;
      return { accessToken: 'jwt-novo', expiresIn: 90 };
    }, bus);
    const grant = next.refresh();
    await flushJitter();
    expect((await grant).accessToken).toBe('jwt-novo');
    expect(posts).toBe(2);
    expect(JSON.stringify(readLease())).not.toMatch(/jwt/);
    expect(seen.filter((message) => message.type === 'grant').map((message) => message.token)).toEqual([
      'jwt-novo',
    ]);
  });

  it('rejeita grant com leaseId errado e não faz POST', async () => {
    vi.useFakeTimers();
    const leaseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    seed({
      leaseId,
      epoch: 2,
      owner: 'dona',
      until: Date.now() + LEASE_DONE_MS,
      phase: 'done',
    });
    const bus = createBus();
    let posts = 0;
    const follower = tab(
      sharedLocks() as unknown as LockManager,
      async () => {
        posts += 1;
        return { accessToken: 'jwt-nao', expiresIn: 30 };
      },
      bus,
    );
    const pending = follower.refresh().then(
      (grant) => grant.accessToken,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    bus.channel().postMessage({
      v: 1,
      type: 'grant',
      leaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      token: 'jwt-errado',
      expiresIn: 30,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(posts).toBe(0);
    await vi.advanceTimersByTimeAsync(LEASE_DONE_MS);
    const result = await pending;
    expect(result).toBeInstanceOf(SessionExpiredError);
    expect(posts).toBe(0);
    expect(JSON.stringify(window.localStorage)).not.toMatch(/jwt-errado/);
  });

  it.each([
    ['com locks', true],
    ['sem locks', false],
  ])('%s: várias abas sem canal, a que não é dona falha fechado', async (_label, withLocks) => {
    vi.useFakeTimers();
    const locks = withLocks ? (sharedLocks() as unknown as LockManager) : null;
    let posts = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const make = () =>
      tab(
        locks,
        async () => {
          posts += 1;
          if (posts === 1) {
            await gate;
          }
          return { accessToken: 'jwt-dona', expiresIn: 40 };
        },
        null,
      );
    const owner = make();
    const ownerPending = owner.refresh();
    await flushJitter();
    expect(posts).toBe(1);
    expect(readLease()?.phase).toBe('sending');
    const followers = [make(), make(), make()];
    const results = await Promise.all(
      followers.map((item) =>
        item.refresh().then(
          () => 'ok',
          (error: unknown) => error,
        ),
      ),
    );
    expect(posts).toBe(1);
    expect(results.every((result) => result instanceof SessionExpiredError)).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect((await ownerPending).accessToken).toBe('jwt-dona');
    expect(posts).toBe(1);
    expect(JSON.stringify(readLease())).not.toMatch(/jwt/);
  });

  it('lease inválido, epoch fracionário, phase desconhecida ou until longe demais libera epoch novo', async () => {
    vi.useFakeTimers();
    const raws = [
      '{',
      JSON.stringify({ phase: 'sumiu', epoch: 2, leaseId: 'x', owner: 'y', until: Date.now() }),
      JSON.stringify({
        phase: 'open',
        epoch: 1.5,
        leaseId: 'x',
        owner: 'y',
        until: Date.now() + 1_000,
      }),
      JSON.stringify({
        phase: 'open',
        epoch: 4,
        leaseId: 'x',
        owner: 'y',
        until: Date.now() + LEASE_OPEN_MS + 5_000,
        token: 'jwt-escondido',
      }),
    ];
    for (const raw of raws) {
      window.localStorage.setItem(SESSION_LEASE_KEY, raw);
      let posts = 0;
      const coord = tab(null, async () => {
        posts += 1;
        const during = window.localStorage.getItem(SESSION_LEASE_KEY) ?? '';
        expect(during).not.toBe(raw);
        expect(during).not.toMatch(/jwt|escondido/);
        return { accessToken: 'jwt-limpo', expiresIn: 10 };
      }, createBus());
      const grant = coord.refresh();
      await flushJitter();
      expect((await grant).accessToken).toBe('jwt-limpo');
      expect(posts).toBe(1);
      expect(readLease()?.phase).toBe('done');
      coord.reset();
      window.localStorage.removeItem(SESSION_LEASE_KEY);
    }
  });

  it('com loggedOut o batimento para e não recria a chave', async () => {
    vi.useFakeTimers();
    let release: (grant: { accessToken: string; expiresIn: number | null }) => void = () => {};
    const coord = tab(
      null,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      createBus(),
    );
    const pending = coord.refresh().then(
      () => 'ok',
      () => 'fail',
    );
    await flushJitter();
    const before = readLease();
    expect(before?.phase).toBe('sending');
    markLoggedOut();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_GAP);
    expect(readLease()?.leaseId).toBe(before?.leaseId);
    expect(readLease()?.phase).toBe('sending');
    clearSessionRefreshMark();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_GAP);
    expect(readLease()).toBeNull();
    release({ accessToken: 'jwt-depois-do-logout', expiresIn: 30 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toBe('fail');
    expect(window.localStorage.getItem(SESSION_LEASE_KEY)).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toMatch(/jwt-depois-do-logout/);
  });
});

const HEARTBEAT_GAP = 1_000;
