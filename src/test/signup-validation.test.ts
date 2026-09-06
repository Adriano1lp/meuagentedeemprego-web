import { describe, expect, it } from 'vitest';

import { canSubmitSignup, validateSignup } from '../auth/signupValidation';

const validFields = {
  displayName: 'Ada',
  email: 'ada@example.com',
  password: 'senha-segura',
};

describe('canSubmitSignup', () => {
  it('bloqueia envio sem os dois checkboxes', () => {
    expect(
      canSubmitSignup({
        ...validFields,
        termsLoaded: true,
        privacyLoaded: true,
        termsAccepted: false,
        privacyAccepted: false,
      }),
    ).toBe(false);

    expect(
      canSubmitSignup({
        ...validFields,
        termsLoaded: true,
        privacyLoaded: true,
        termsAccepted: true,
        privacyAccepted: false,
      }),
    ).toBe(false);

    expect(
      canSubmitSignup({
        ...validFields,
        termsLoaded: true,
        privacyLoaded: true,
        termsAccepted: false,
        privacyAccepted: true,
      }),
    ).toBe(false);
  });

  it('bloqueia se os textos legais ainda nao carregaram', () => {
    expect(
      canSubmitSignup({
        ...validFields,
        termsLoaded: false,
        privacyLoaded: true,
        termsAccepted: true,
        privacyAccepted: true,
      }),
    ).toBe(false);
  });

  it('libera apenas com os dois textos e os dois aceites', () => {
    expect(
      canSubmitSignup({
        ...validFields,
        termsLoaded: true,
        privacyLoaded: true,
        termsAccepted: true,
        privacyAccepted: true,
      }),
    ).toBe(true);
  });
});

describe('validateSignup', () => {
  it('pede aceite quando falta checkbox', () => {
    expect(
      validateSignup({
        ...validFields,
        termsLoaded: true,
        privacyLoaded: true,
        termsAccepted: false,
        privacyAccepted: true,
      }),
    ).toBe(
      'Aceite os Termos de uso e a Politica de privacidade para criar a conta.',
    );
  });
});
