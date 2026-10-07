import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BILLING_POLL_DEADLINE_MS,
  BILLING_POLL_INTERVAL_MS,
  pollBillingUntilEssencial,
  type BillingMe,
} from '../api/billing';

const freeBilling: BillingMe = {
  plan: 'free',
  subscription_status: 'none',
  used: 5,
  limit: 5,
  remaining: 0,
  period: '2026-10',
};

const essencialBilling: BillingMe = {
  plan: 'essencial',
  subscription_status: 'active',
  used: 5,
  limit: 30,
  remaining: 25,
  period: '2026-10',
};

describe('polling de GET /billing/me', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('consulta na hora e de novo a cada 3s até o plano essencial', async () => {
    vi.useFakeTimers();
    const reads: number[] = [];
    const pending = pollBillingUntilEssencial(async () => {
      reads.push(Date.now());
      return reads.length >= 2 ? essencialBilling : freeBilling;
    }, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BILLING_POLL_INTERVAL_MS - 1);
    expect(reads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('essencial');
    expect(reads).toHaveLength(2);
    expect(reads[1] - reads[0]).toBe(BILLING_POLL_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(BILLING_POLL_DEADLINE_MS);
    expect(reads).toHaveLength(2);
  });

  it('aos 60s devolve timeout sem promover o plano', async () => {
    vi.useFakeTimers();
    let reads = 0;
    let settled = false;
    const pending = pollBillingUntilEssencial(async () => {
      reads += 1;
      return freeBilling;
    }, new AbortController().signal).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(BILLING_POLL_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    expect(reads).toBeGreaterThan(1);

    const readsAtDeadlineEdge = reads;
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('timeout');
    expect(reads).toBe(readsAtDeadlineEdge);

    await vi.advanceTimersByTimeAsync(BILLING_POLL_INTERVAL_MS * 3);
    expect(reads).toBe(readsAtDeadlineEdge);
  });

  it('abort para o polling e o timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let reads = 0;
    const pending = pollBillingUntilEssencial(async () => {
      reads += 1;
      return freeBilling;
    }, controller.signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(BILLING_POLL_DEADLINE_MS);
    expect(reads).toBe(1);
  });
});
