import { describe, expect, it } from 'vitest';

import { hasQuotaFields, parseUserStatus, planLabel } from '../api/status';

describe('parseUserStatus', () => {
  it('espelha so os campos de GET /users/me/status sem inventar cota', () => {
    const status = parseUserStatus({
      user_id: 'user-1',
      has_cv: true,
      has_profile: false,
      has_embeddings: true,
      generated_files: 2,
    });

    expect(status).toEqual({
      user_id: 'user-1',
      has_cv: true,
      has_profile: false,
      has_embeddings: true,
      generated_files: 2,
      plan: undefined,
      subscription_status: undefined,
      used: undefined,
      limit: undefined,
      remaining: undefined,
      period: undefined,
    });
    expect(hasQuotaFields(status)).toBe(false);
  });

  it('repassa plan/used/limit/remaining/period quando o status os trouxer', () => {
    const status = parseUserStatus({
      user_id: 'user-1',
      has_cv: true,
      has_embeddings: true,
      plan: 'free',
      used: 1,
      limit: 5,
      remaining: 4,
      period: '2026-09',
      subscription_status: 'none',
    });

    expect(status.plan).toBe('free');
    expect(status.used).toBe(1);
    expect(status.limit).toBe(5);
    expect(status.remaining).toBe(4);
    expect(status.period).toBe('2026-09');
    expect(hasQuotaFields(status)).toBe(true);
    expect(planLabel(status.plan)).toBe('Free');
  });

  it('nao calcula remaining a partir de used/limit', () => {
    const status = parseUserStatus({
      plan: 'essencial',
      used: 3,
      limit: 30,
    });

    expect(status.remaining).toBeUndefined();
    expect(planLabel(status.plan)).toBe('Essencial');
  });

  it('rejeita payload que nao e objeto', () => {
    expect(() => parseUserStatus('ok')).toThrow(/status/);
    expect(() => parseUserStatus(null)).toThrow(/status/);
  });
});
