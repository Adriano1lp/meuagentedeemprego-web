import { useState, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canSubmitSignup, validateSignup } from '../auth/signupValidation';
import { LegalDocument } from '../components/LegalDocument';
import { LegalDoc } from '../legal/versions';

type AuthTab = 'login' | 'signup';

export function AuthPage() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<AuthTab>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsLoaded, setTermsLoaded] = useState(false);
  const [privacyLoaded, setPrivacyLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signupState = {
    displayName,
    email: signupEmail,
    password: signupPassword,
    termsAccepted,
    privacyAccepted,
    termsLoaded,
    privacyLoaded,
  };
  const canCreate = canSubmitSignup(signupState);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      setError('Preencha email e senha.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(loginEmail.trim(), loginPassword);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Falha ao autenticar com a API',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignup(event: FormEvent) {
    event.preventDefault();
    const validation = validateSignup(signupState);
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register({
        displayName: displayName.trim(),
        email: signupEmail.trim(),
        password: signupPassword,
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Falha ao autenticar com a API',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-5 pb-7 pt-5">
      <header className="mb-5">
        <p className="font-display text-xl font-extrabold text-ink">
          Entrar na conta
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Autenticacao"
        className="mb-5 grid grid-cols-2 overflow-hidden rounded-[18px] border-[3px] border-ink bg-paper shadow-[4px_4px_0_#111]"
      >
        <button
          type="button"
          role="tab"
          id="tab-login"
          data-testid="auth-tab-login"
          aria-selected={tab === 'login'}
          aria-controls="panel-login"
          className={`px-4 py-3 font-display text-[15px] font-extrabold ${
            tab === 'login' ? 'bg-sky' : 'bg-paper'
          }`}
          onClick={() => {
            setTab('login');
            setError(null);
          }}
        >
          Entrar
        </button>
        <button
          type="button"
          role="tab"
          id="tab-signup"
          data-testid="auth-tab-signup"
          aria-selected={tab === 'signup'}
          aria-controls="panel-signup"
          className={`px-4 py-3 font-display text-[15px] font-extrabold ${
            tab === 'signup' ? 'bg-yellow' : 'bg-paper'
          }`}
          onClick={() => {
            setTab('signup');
            setError(null);
          }}
        >
          Criar conta
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-sm text-ink"
        >
          {error}
        </p>
      ) : null}

      {tab === 'login' ? (
        <div id="panel-login" role="tabpanel" aria-labelledby="tab-login">
          <section className="mb-5 rounded-3xl border-[3px] border-ink bg-yellow p-6 shadow-[8px_8px_0_#111]">
            <p className="inline-block rounded-full border-[3px] border-ink bg-paper px-3 py-1 text-xs font-bold shadow-[3px_3px_0_#111]">
              Recuperacao entre dispositivos
            </p>
            <h1 className="mt-4 font-display text-[38px] font-extrabold leading-none tracking-tight text-ink">
              Entre para recuperar sua conta
            </h1>
            <p className="mt-3 text-base leading-[1.45] text-ink">
              Ao entrar, o app consulta seu status na API e restaura o acesso ao
              curriculo, embeddings e PDFs do usuario autenticado.
            </p>
          </section>

          <form
            onSubmit={handleLogin}
            className="rounded-3xl border-[3px] border-ink bg-sky p-5 shadow-[8px_8px_0_#111]"
          >
            <h2 className="font-display text-[22px] font-extrabold text-ink">
              Acessar conta existente
            </h2>
            <label className="mt-4 block text-sm text-ink" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              data-testid="login-email"
              type="email"
              autoComplete="email"
              className="mt-1 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-ink"
              placeholder="Email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
            />
            <label className="mt-3 block text-sm text-ink" htmlFor="login-password">
              Senha
            </label>
            <input
              id="login-password"
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-ink"
              placeholder="Senha"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />
            <button
              type="submit"
              data-testid="login-submit"
              disabled={submitting}
              className="mt-5 w-full rounded-[18px] border-[3px] border-ink bg-green px-4 py-3 font-display text-[15px] font-extrabold disabled:opacity-60"
            >
              {submitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      ) : (
        <div id="panel-signup" role="tabpanel" aria-labelledby="tab-signup">
          <form
            onSubmit={handleSignup}
            className="rounded-3xl border-[3px] border-ink bg-yellow p-5 shadow-[8px_8px_0_#111]"
          >
            <h2 className="font-display text-[22px] font-extrabold text-ink">
              Criar conta nova
            </h2>
            <label className="mt-4 block text-sm text-ink" htmlFor="signup-name">
              Nome
            </label>
            <input
              id="signup-name"
              data-testid="signup-name"
              type="text"
              autoComplete="name"
              className="mt-1 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-ink"
              placeholder="Nome"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <label className="mt-3 block text-sm text-ink" htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
              data-testid="signup-email"
              type="email"
              autoComplete="email"
              className="mt-1 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-ink"
              placeholder="Email"
              value={signupEmail}
              onChange={(event) => setSignupEmail(event.target.value)}
            />
            <label className="mt-3 block text-sm text-ink" htmlFor="signup-password">
              Senha
            </label>
            <input
              id="signup-password"
              data-testid="signup-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              className="mt-1 w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-ink"
              placeholder="Senha com pelo menos 8 caracteres"
              value={signupPassword}
              onChange={(event) => setSignupPassword(event.target.value)}
            />

            <div className="mt-4">
              <LegalDocument
                doc={LegalDoc.terms}
                accepted={termsAccepted}
                onAcceptedChange={setTermsAccepted}
                onLoadedChange={setTermsLoaded}
                enabled={!submitting}
              />
              <LegalDocument
                doc={LegalDoc.privacy}
                accepted={privacyAccepted}
                onAcceptedChange={setPrivacyAccepted}
                onLoadedChange={setPrivacyLoaded}
                enabled={!submitting}
              />
            </div>

            <button
              type="submit"
              data-testid="createAccountButton"
              disabled={!canCreate || submitting}
              className={`mt-2 w-full rounded-[18px] border-[3px] border-ink px-4 py-3 font-display text-[15px] font-extrabold ${
                canCreate && !submitting
                  ? 'bg-green'
                  : 'cursor-not-allowed bg-paper text-muted'
              }`}
            >
              {submitting ? 'Criando...' : 'Criar conta'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
