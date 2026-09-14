import { hasQuotaFields, planLabel } from '../api/status';
import type { UserStatus } from '../api/types';

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
    <section
      data-testid="status-card"
      aria-labelledby="status-title"
      className="mt-6 rounded-3xl border-[3px] border-ink bg-yellow p-6 shadow-[8px_8px_0_#111]"
    >
      <p className="inline-block rounded-full border-[3px] border-ink bg-paper px-3 py-1 text-xs font-bold">
        GET /users/me/status
      </p>
      <h2
        id="status-title"
        className="mt-4 font-display text-[28px] font-extrabold leading-none text-ink"
      >
        Cota e status
      </h2>
      <p className="mt-3 text-sm leading-[1.45] text-ink">
        Plano e cota do mes UTC vêm so do servidor. O navegador nao calcula
        nem guarda o limite.
      </p>

      {loading ? (
        <p
          data-testid="status-loading"
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-ink"
        >
          Carregando status...
        </p>
      ) : null}

      {error ? (
        <div data-testid="status-error" className="mt-4" role="alert">
          <p className="text-sm text-ink">{error}</p>
          <button
            type="button"
            data-testid="status-retry"
            onClick={onRetry}
            className="mt-3 rounded-[18px] border-[3px] border-ink bg-paper px-4 py-2 font-display text-sm font-extrabold"
          >
            Tentar de novo
          </button>
        </div>
      ) : null}

      {!loading && !error && !status ? (
        <p data-testid="status-empty" className="mt-4 text-sm text-ink">
          Status ainda nao carregado.
        </p>
      ) : null}

      {!loading && !error && status ? (
        <dl
          data-testid="status-values"
          className="mt-4 grid gap-3 text-sm text-ink sm:grid-cols-2"
        >
          {planLabel(status.plan) ? (
            <div>
              <dt className="font-bold">Plano</dt>
              <dd data-testid="status-plan">{planLabel(status.plan)}</dd>
            </div>
          ) : null}
          {status.period ? (
            <div>
              <dt className="font-bold">Periodo (UTC)</dt>
              <dd data-testid="status-period">{status.period}</dd>
            </div>
          ) : null}
          {hasQuotaFields(status) ? (
            <div className="sm:col-span-2">
              <dt className="font-bold">Cota do mes</dt>
              <dd data-testid="status-quota">
                {formatQuota(status)}
              </dd>
            </div>
          ) : null}
          {yesNo(status.has_embeddings) ? (
            <div>
              <dt className="font-bold">Embeddings</dt>
              <dd data-testid="status-embeddings">
                {status.has_embeddings
                  ? 'prontos para analisar'
                  : 'ausentes — envie o curriculo na API antes de processar'}
              </dd>
            </div>
          ) : null}
          {yesNo(status.has_cv) ? (
            <div>
              <dt className="font-bold">Curriculo</dt>
              <dd data-testid="status-cv">{yesNo(status.has_cv)}</dd>
            </div>
          ) : null}
          {typeof status.generated_files === 'number' ? (
            <div>
              <dt className="font-bold">Arquivos gerados</dt>
              <dd data-testid="status-generated-files">
                {status.generated_files}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
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
