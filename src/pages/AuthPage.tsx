import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { BILLING_LOGIN_AFTER_PAYMENT } from '../api/billing';
import { ApiError } from '../api/client';
import { ACCOUNT_DELETED_NOTICE, useAuth } from '../auth/AuthContext';
import {
  APP_HOME,
  consumeReturnTo,
  forgetReturnTo,
  isSafeAppPath,
  rememberReturnTo,
} from '../auth/returnTo';
import { useBillingReturn } from '../billing/BillingReturn';
import { canSubmitSignup, validateSignup } from '../auth/signupValidation';
import { LegalDocument } from '../components/LegalDocument';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { LegalDoc } from '../legal/versions';
import { cn } from '@/lib/utils';

type AuthTab = 'login' | 'signup';

export function AuthPage() {
  const { accountDeleted, login, register } = useAuth();
  const { intent: billingIntent } = useBillingReturn();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next');
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState<AuthTab>(tabParam === 'signup' ? 'signup' : 'login');

  useEffect(() => {
    if (next && isSafeAppPath(next)) {
      rememberReturnTo(next);
      return;
    }
    if (tabParam === 'signup') {
      forgetReturnTo();
    }
  }, [next, tabParam]);

  function goAfterAuth() {
    navigate(consumeReturnTo(APP_HOME), { replace: true });
  }
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
      goAfterAuth();
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
        termsAccepted,
        privacyAccepted,
      });
      goAfterAuth();
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
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-8 md:justify-center md:py-12">
      <header className="mb-6 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          M
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            Meu Agente de Emprego
          </p>
          <p className="font-display text-xl font-semibold tracking-tight">
            Entrar na conta
          </p>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Autenticacao"
        className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        <button
          type="button"
          role="tab"
          id="tab-login"
          data-testid="auth-tab-login"
          aria-selected={tab === 'login'}
          aria-controls="panel-login"
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium',
            tab === 'login'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground',
          )}
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
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium',
            tab === 'signup'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground',
          )}
          onClick={() => {
            setTab('signup');
            setError(null);
          }}
        >
          Criar conta
        </button>
      </div>

      {billingIntent === 'success' ? (
        <Alert
          data-testid="billing-login-notice"
          role="status"
          variant="success"
          className="mb-4"
        >
          <AlertDescription>{BILLING_LOGIN_AFTER_PAYMENT}</AlertDescription>
        </Alert>
      ) : null}

      {accountDeleted ? (
        <Alert
          data-testid="account-deleted-notice"
          role="status"
          variant="success"
          className="mb-4"
        >
          <AlertDescription>{ACCOUNT_DELETED_NOTICE}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert role="alert" variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {tab === 'login' ? (
        <div id="panel-login" role="tabpanel" aria-labelledby="tab-login">
          <Card className="mb-5">
            <CardHeader className="pb-5 md:pb-6">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                Recuperacao entre dispositivos
              </p>
              <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight">
                Entre para recuperar sua conta
              </h1>
              <CardDescription className="text-foreground">
                Ao entrar, o app consulta seu status na API e restaura o acesso ao
                curriculo, embeddings e PDFs do usuario autenticado.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <form onSubmit={handleLogin} className="px-5 py-5 md:px-6 md:py-6">
              <h2 className="font-display text-lg font-semibold">
                Acessar conta existente
              </h2>
              <Label className="mt-4 block" htmlFor="login-email">
                Email
              </Label>
              <Input
                id="login-email"
                data-testid="login-email"
                type="email"
                autoComplete="email"
                className="mt-1.5"
                placeholder="Email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
              />
              <Label className="mt-3 block" htmlFor="login-password">
                Senha
              </Label>
              <Input
                id="login-password"
                data-testid="login-password"
                type="password"
                autoComplete="current-password"
                className="mt-1.5"
                placeholder="Senha"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
              <Button
                type="submit"
                data-testid="login-submit"
                disabled={submitting}
                className="mt-5 w-full"
                size="lg"
              >
                {submitting ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          </Card>
        </div>
      ) : (
        <div id="panel-signup" role="tabpanel" aria-labelledby="tab-signup">
          <Card>
            <form onSubmit={handleSignup} className="px-5 py-5 md:px-6 md:py-6">
              <h2 className="font-display text-lg font-semibold">
                Criar conta nova
              </h2>
              <Label className="mt-4 block" htmlFor="signup-name">
                Nome
              </Label>
              <Input
                id="signup-name"
                data-testid="signup-name"
                type="text"
                autoComplete="name"
                className="mt-1.5"
                placeholder="Nome"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <Label className="mt-3 block" htmlFor="signup-email">
                Email
              </Label>
              <Input
                id="signup-email"
                data-testid="signup-email"
                type="email"
                autoComplete="email"
                className="mt-1.5"
                placeholder="Email"
                value={signupEmail}
                onChange={(event) => setSignupEmail(event.target.value)}
              />
              <Label className="mt-3 block" htmlFor="signup-password">
                Senha
              </Label>
              <Input
                id="signup-password"
                data-testid="signup-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                className="mt-1.5"
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

              <Button
                type="submit"
                data-testid="createAccountButton"
                disabled={!canCreate || submitting}
                className="mt-2 w-full"
                size="lg"
              >
                {submitting ? 'Criando...' : 'Criar conta'}
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
