import { describe, expect, it } from 'vitest';

import {
  parseQuotaResponse,
  QUOTA_EXCEEDED,
  SUBSCRIPTION_REQUIRED,
} from '../api/quota';

describe('parseQuotaResponse', () => {
  it('parseia 402 QUOTA_EXCEEDED', () => {
    const parsed = parseQuotaResponse(402, {
      detail: {
        code: QUOTA_EXCEEDED,
        message: 'Cota mensal do plano Essencial esgotada.',
        used: 30,
        limit: 30,
        plan: 'essencial',
      },
    });

    expect(parsed).toEqual({
      code: QUOTA_EXCEEDED,
      message: 'Cota mensal do plano Essencial esgotada.',
      used: 30,
      limit: 30,
      plan: 'essencial',
    });
  });

  it('parseia 402 SUBSCRIPTION_REQUIRED', () => {
    const parsed = parseQuotaResponse(402, {
      detail: {
        code: SUBSCRIPTION_REQUIRED,
        message:
          'Cota gratuita do mes esgotada. Assine o plano Essencial para continuar.',
        used: 5,
        limit: 5,
        plan: 'free',
      },
    });

    expect(parsed?.code).toBe(SUBSCRIPTION_REQUIRED);
    expect(parsed?.message).toContain('Essencial');
  });

  it('ignora 400/403 mesmo com codigo de cota', () => {
    expect(
      parseQuotaResponse(400, {
        detail: { code: SUBSCRIPTION_REQUIRED },
      }),
    ).toBeNull();
    expect(
      parseQuotaResponse(403, {
        detail: { code: QUOTA_EXCEEDED },
      }),
    ).toBeNull();
  });
});
