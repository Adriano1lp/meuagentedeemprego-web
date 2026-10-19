import { Download, History, Mail, TextSearch } from 'lucide-react';
import { Link } from 'react-router-dom';

import { SUBSCRIBE_ESSENCIAL_LABEL } from '../api/billing';
import { useAuth } from '../auth/AuthContext';
import { APP_HOME, APP_PROFILE, ENTER_PATH } from '../auth/returnTo';
import { SupportLink } from '../components/SupportLink';
import { SUPPORT_EMAIL } from '../config/support';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

const ESSENCIAL_PRICE = SUBSCRIBE_ESSENCIAL_LABEL.replace(
  'Assinar Essencial ',
  '',
);

const signupPath = `${ENTER_PATH}?tab=signup`;
const subscribePath = `${ENTER_PATH}?next=${encodeURIComponent(APP_PROFILE)}`;

const steps = [
  {
    title: 'Currículo',
    text: 'Envie o currículo em PDF ou TXT. A análise da vaga só fica disponível quando o currículo está pronto.',
  },
  {
    title: 'Análise da vaga',
    text: 'Cole o texto da vaga. A análise mostra a resposta, o match quando ele existe, e o PDF quando ele é gerado.',
  },
  {
    title: 'Histórico, CV e carta',
    text: 'O histórico lista as análises da conta. Em cada uma dá para baixar o CV, quando o arquivo existe, e gerar a carta de apresentação.',
  },
] as const;

const features = [
  {
    icon: TextSearch,
    title: 'Análise de vaga x currículo',
    text: 'Compara o texto da vaga com o currículo já enviado.',
  },
  {
    icon: History,
    title: 'Histórico',
    text: 'Lista as análises salvas da sua conta.',
  },
  {
    icon: Mail,
    title: 'Carta de apresentação',
    text: 'Gera a carta para a empresa da vaga, para copiar ou baixar em PDF.',
  },
  {
    icon: Download,
    title: 'Download de CV',
    text: 'Baixa o CV gerado na análise quando o histórico traz o arquivo.',
  },
] as const;

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  const startPath = isAuthenticated ? APP_HOME : signupPath;
  const essencialPath = isAuthenticated ? APP_PROFILE : subscribePath;

  return (
    <div data-testid="landing-page" className="min-h-dvh overflow-x-clip">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
          >
            M
          </span>
          <p className="truncate font-display text-sm font-semibold">
            Meu Agente de Emprego
          </p>
        </div>
        {isAuthenticated ? (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to={APP_HOME} data-testid="cta-ir-para-o-app">
              Ir para o app
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to={ENTER_PATH}>Entrar</Link>
          </Button>
        )}
      </header>

      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16">
        <section className="py-8 md:py-14">
          <Badge variant="secondary">Meu Agente de Emprego</Badge>
          <h1 className="mt-4 max-w-3xl font-display text-3xl font-semibold tracking-tight text-balance md:text-5xl">
            Análise de vaga com o seu currículo
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
            Envie o currículo e analise o texto de uma vaga. O histórico guarda
            as análises. Dá para baixar o CV gerado e a carta de apresentação.
          </p>
          <div className="mt-6 flex w-full max-w-md flex-col gap-3 sm:max-w-none sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to={startPath} data-testid="cta-comecar-gratis">
                {isAuthenticated ? 'Ir para o app' : 'Começar grátis'}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link to={essencialPath} data-testid="cta-assinar-essencial">
                Assinar Essencial
              </Link>
            </Button>
          </div>
        </section>

        <section aria-labelledby="como-funciona" className="py-6">
          <h2
            id="como-funciona"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            Como funciona
          </h2>
          <ol className="mt-4 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="min-w-0">
                <Card className="h-full">
                  <CardHeader>
                    <Badge variant="outline">{index + 1}</Badge>
                    <CardTitle className="text-lg">{step.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{step.text}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="o-que-faz" className="py-6">
          <h2
            id="o-que-faz"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            O que o produto faz
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <li key={feature.title} className="min-w-0">
                  <Card className="h-full">
                    <CardHeader>
                      <Icon aria-hidden="true" className="size-5 text-primary" />
                      <CardTitle className="text-lg">{feature.title}</CardTitle>
                      <CardDescription>{feature.text}</CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="planos" className="py-6">
          <h2
            id="planos"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            Planos
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            A cota é mensal. Free tem limite de 5 análises por mês. Essencial
            tem limite de 30 análises por mês.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Free</CardTitle>
                <CardDescription>
                  Cota mensal de 5 análises.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full" variant="outline">
                  <Link to={startPath}>
                    {isAuthenticated ? 'Ir para o app' : 'Começar grátis'}
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-primary/40">
              <CardHeader>
                <Badge>Essencial</Badge>
                <CardTitle>Essencial</CardTitle>
                <CardDescription>
                  Cota mensal de 30 análises.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-semibold">{ESSENCIAL_PRICE}</p>
                <p className="mt-4 text-sm text-muted-foreground">
                  A assinatura começa no Perfil, depois do login. O checkout não
                  inicia nesta página.
                </p>
                <Button asChild className="mt-5 w-full">
                  <Link to={essencialPath}>Assinar Essencial</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer
        data-testid="landing-footer"
        className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-10"
      >
        <SupportLink data-testid="support-link-landing" className="max-w-full">
          Suporte: {SUPPORT_EMAIL}
        </SupportLink>
      </footer>
    </div>
  );
}
