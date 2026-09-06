export type SignupFormState = {
  displayName: string;
  email: string;
  password: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  termsLoaded: boolean;
  privacyLoaded: boolean;
};

/** Botao "Criar conta" so habilita apos os dois textos e os dois aceites. */
export function canSubmitSignup(state: SignupFormState): boolean {
  return (
    state.termsLoaded &&
    state.privacyLoaded &&
    state.termsAccepted &&
    state.privacyAccepted
  );
}

export function validateSignup(state: SignupFormState): string | null {
  if (!state.displayName.trim() || !state.email.trim() || !state.password) {
    return 'Preencha nome, email e senha.';
  }
  if (
    !state.termsAccepted ||
    !state.privacyAccepted ||
    !state.termsLoaded ||
    !state.privacyLoaded
  ) {
    return 'Aceite os Termos de uso e a Politica de privacidade para criar a conta.';
  }
  return null;
}
