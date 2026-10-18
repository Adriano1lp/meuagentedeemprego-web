import {
  formatQuotaResetLabel,
  isEssencialActive,
  isQuotaExhausted,
  quotaUsageText,
  type BillingMe,
} from '../api/billing';
import { planLabel } from '../api/status';
import { SubscribeEssencialButton } from './SubscribeEssencialButton';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from './ui/card';
import { Skeleton } from './ui/skeleton';

type QuotaStatusCardProps = {
  billing: BillingMe | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

const QUOTA_LOAD_ERROR = 'Não foi possível carregar a cota agora.';
const QUOTA_EXHAUSTED_FREE = 'As análises deste período acabaram.';

export function QuotaStatusCard({
  billing,
  loading,
  error,
  onRetry,
}: QuotaStatusCardProps) {
  const usage = billing ? quotaUsageText(billing) : null;
  const resetLabel = formatQuotaResetLabel(billing?.period_end);
  const exhausted = billing ? isQuotaExhausted(billing) : false;
  const essencial = billing ? isEssencialActive(billing) : false;
  const plan = planLabel(billing?.plan ?? undefined);

  return (
    <Card data-testid="status-card" aria-labelledby="status-title" className="mt-6">
      <CardHeader>
        <CardTitle id="status-title">Cota do mês</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? (
          <div data-testid="quota-skeleton" role="status" aria-live="polite" className="grid gap-3">
            <span className="sr-only">Carregando cota</span>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full max-w-xs" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
        ) : null}

        {!loading && error ? (
          <Alert data-testid="quota-error" role="status" variant="warning">
            <AlertDescription>
              <p>{error || QUOTA_LOAD_ERROR}</p>
              <Button
                type="button"
                data-testid="quota-retry"
                onClick={onRetry}
                variant="outline"
                size="sm"
                className="mt-3"
              >
                Tentar de novo
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && !error && billing ? (
          <div className="grid gap-3">
            {plan ? (
              <p className="text-sm text-muted-foreground">
                Plano{' '}
                <span data-testid="status-plan" className="font-medium text-foreground">
                  {plan}
                </span>
              </p>
            ) : null}
            {usage ? (
              <p data-testid="status-quota" className="font-display text-2xl font-semibold tracking-tight">
                {usage}
              </p>
            ) : null}
            {resetLabel ? (
              <p data-testid="quota-reset" className="text-sm text-muted-foreground">
                {resetLabel}
              </p>
            ) : null}
            {exhausted && !essencial ? (
              <div data-testid="quota-exhausted" role="status" className="grid gap-1">
                <p className="text-sm">{QUOTA_EXHAUSTED_FREE}</p>
                <SubscribeEssencialButton label="Assinar Essencial" testId="quota-subscribe" />
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export { QUOTA_EXHAUSTED_FREE, QUOTA_LOAD_ERROR };
