import { hasQuotaFields, planLabel } from '../api/status';
import type { UserStatus } from '../api/types';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';

type QuotaStatusCardProps = {
  status: UserStatus | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function yesNo(value: boolean | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return value ? 'sim' : 'nao';
}

export function QuotaStatusCard({
  status,
  loading,
  error,
  onRetry,
}: QuotaStatusCardProps) {
  return (
    <Card
      data-testid="status-card"
      aria-labelledby="status-title"
      className="mt-6"
    >
      <CardHeader>
        <Badge variant="outline">GET /users/me/status</Badge>
        <CardTitle id="status-title">Cota e status</CardTitle>
        <CardDescription>
          Plano e cota do mes UTC vêm so do servidor. O navegador nao calcula
          nem guarda o limite.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading ? (
          <p
            data-testid="status-loading"
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            Carregando status...
          </p>
        ) : null}

        {error ? (
          <Alert data-testid="status-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
            <Button
              type="button"
              data-testid="status-retry"
              onClick={onRetry}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              Tentar de novo
            </Button>
          </Alert>
        ) : null}

        {!loading && !error && !status ? (
          <p data-testid="status-empty" className="text-sm text-muted-foreground">
            Status ainda nao carregado.
          </p>
        ) : null}

        {!loading && !error && status ? (
          <dl
            data-testid="status-values"
            className="grid gap-3 text-sm sm:grid-cols-2"
          >
            {planLabel(status.plan) ? (
              <div className="rounded-lg bg-muted px-3 py-2">
                <dt className="text-xs font-medium text-muted-foreground">Plano</dt>
                <dd data-testid="status-plan" className="mt-0.5 font-medium">
                  {planLabel(status.plan)}
                </dd>
              </div>
            ) : null}
            {status.period ? (
              <div className="rounded-lg bg-muted px-3 py-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Periodo (UTC)
                </dt>
                <dd data-testid="status-period" className="mt-0.5 font-medium">
                  {status.period}
                </dd>
              </div>
            ) : null}
            {hasQuotaFields(status) ? (
              <div className="rounded-lg bg-muted px-3 py-2 sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Cota do mes
                </dt>
                <dd data-testid="status-quota" className="mt-0.5 font-medium">
                  {formatQuota(status)}
                </dd>
              </div>
            ) : null}
            {yesNo(status.has_embeddings) ? (
              <div className="rounded-lg bg-muted px-3 py-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Embeddings
                </dt>
                <dd data-testid="status-embeddings" className="mt-0.5">
                  {status.has_embeddings
                    ? 'prontos para analisar'
                    : 'ausentes — envie o curriculo abaixo'}
                </dd>
              </div>
            ) : null}
            {yesNo(status.has_cv) ? (
              <div className="rounded-lg bg-muted px-3 py-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Curriculo
                </dt>
                <dd data-testid="status-cv" className="mt-0.5">
                  {yesNo(status.has_cv)}
                </dd>
              </div>
            ) : null}
            {typeof status.generated_files === 'number' ? (
              <div className="rounded-lg bg-muted px-3 py-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Arquivos gerados
                </dt>
                <dd data-testid="status-generated-files" className="mt-0.5">
                  {status.generated_files}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatQuota(status: UserStatus): string {
  const parts: string[] = [];
  if (typeof status.used === 'number' && typeof status.limit === 'number') {
    parts.push(`${status.used} de ${status.limit} analises usadas`);
  } else if (typeof status.used === 'number') {
    parts.push(`${status.used} analises usadas`);
  } else if (typeof status.limit === 'number') {
    parts.push(`limite ${status.limit}`);
  }
  if (typeof status.remaining === 'number') {
    parts.push(`${status.remaining} restantes`);
  }
  return parts.join(' · ') || 'cota informada pelo servidor';
}
