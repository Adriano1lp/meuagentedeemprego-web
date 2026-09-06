import { describe, expect, it } from 'vitest';

import { LegalDoc } from '../legal/versions';
import { parseOutdatedError, parseOutdatedResponse } from '../api/outdated';

describe('parseOutdatedError / parseOutdatedResponse', () => {
  it('parseia 403 com detail.code TERMS_OUTDATED', () => {
    const parsed = parseOutdatedResponse(403, {
      detail: {
        code: 'TERMS_OUTDATED',
        message: 'Termos de uso desatualizados. Reaceite a versao vigente.',
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.code).toBe('TERMS_OUTDATED');
    expect(parsed?.doc).toBe(LegalDoc.terms);
    expect(parsed?.message).toContain('Termos de uso');
  });

  it('parseia 403 com detail.code PRIVACY_OUTDATED', () => {
    const parsed = parseOutdatedResponse(403, {
      detail: {
        code: 'PRIVACY_OUTDATED',
        message: 'Politica de privacidade desatualizada.',
      },
    });

    expect(parsed?.code).toBe('PRIVACY_OUTDATED');
    expect(parsed?.doc).toBe(LegalDoc.privacy);
  });

  it('parseia detail string contendo o codigo', () => {
    expect(parseOutdatedError({ detail: 'TERMS_OUTDATED' })?.code).toBe(
      'TERMS_OUTDATED',
    );
  });

  it('ignora 403 generico', () => {
    expect(
      parseOutdatedResponse(403, { detail: 'Sem permissao' }),
    ).toBeNull();
  });

  it('ignora status diferente de 403 mesmo com o codigo', () => {
    expect(
      parseOutdatedResponse(401, {
        detail: { code: 'TERMS_OUTDATED' },
      }),
    ).toBeNull();
  });
});
