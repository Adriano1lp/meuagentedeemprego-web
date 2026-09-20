import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import {
  formatHistoryDate,
  HISTORY_LOAD_FAILED,
  safeHistoryErrorMessage,
} from '../api/history';
import type { GapHistoryItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';

type HistoryView =
  | { kind: 'loading' }
  | { kind: 'list'; items: GapHistoryItem[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export function HistoryPanel() {
  const { api, isAuthenticated, blocksApp } = useAuth();
  const [view, setView] = useState<HistoryView>({ kind: 'loading' });
  const canLoad = isAuthenticated && !blocksApp;

  const loadHistory = useCallback(async () => {
    if (!canLoad) {
      return;
    }
    setView({ kind: 'loading' });
    try {
      const response = await api.getGapHistory();
      setView(
        response.items.length > 0
          ? { kind: 'list', items: response.items }
          : { kind: 'empty' },
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      setView({
        kind: 'error',
        message: safeHistoryErrorMessage(cause),
      });
    }
  }, [api, canLoad]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <section
      data-testid="history-panel"
      aria-labelledby="history-title"
      className="mt-8 rounded-3xl border-[3px] border-ink bg-sky p-6 shadow-[8px_8px_0_#111]"
    >
      <p className="inline-block rounded-full border-[3px] border-ink bg-paper px-3 py-1 text-xs font-bold">
        Analises desta conta
      </p>
      <h2
        id="history-title"
        className="mt-4 font-display text-[28px] font-extrabold leading-none text-ink"
      >
        Historico
      </h2>
      <p className="mt-3 text-sm leading-[1.45] text-ink">
        Resumo das analises de vaga desta sessao. So o dono do JWT ve a
        lista; o navegador nao envia X-User-Id.
      </p>

      {view.kind === 'loading' ? (
        <p
          data-testid="history-loading"
          role="status"
          aria-live="polite"
          className="mt-5 text-sm text-ink"
        >
          Carregando historico...
        </p>
      ) : null}

      {view.kind === 'empty' ? (
        <div
          data-testid="history-empty"
          role="status"
          className="mt-5 rounded-[18px] border-[3px] border-ink bg-yellow p-5"
        >
          <p className="font-display text-lg font-extrabold text-ink">
            Nenhum retorno salvo ainda.
          </p>
          <p className="mt-2 text-sm leading-[1.45] text-muted">
            Quando o assistente analisar uma vaga, o titulo, a empresa, a
            aderencia e a data aparecem aqui.
          </p>
        </div>
      ) : null}

      {view.kind === 'error' ? (
        <div
          data-testid="history-error"
          role="alert"
          className="mt-5 rounded-[18px] border-[3px] border-ink bg-pink p-5"
        >
          <p className="font-display text-lg font-extrabold text-ink">
            Nao foi possivel carregar o historico.
          </p>
          <p className="mt-2 text-sm leading-[1.45] text-ink">
            {view.message || HISTORY_LOAD_FAILED}
          </p>
          <button
            type="button"
            data-testid="history-retry"
            onClick={() => void loadHistory()}
            className="mt-4 rounded-[18px] border-[3px] border-ink bg-paper px-4 py-2 font-display text-sm font-extrabold"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {view.kind === 'list' ? (
        <ul
          data-testid="history-list"
          className="mt-5 grid gap-4"
        >
          {view.items.map((item) => (
            <HistoryCard key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function HistoryCard({ item }: { item: GapHistoryItem }) {
  const formattedDate = formatHistoryDate(item.created_at);
  const title = item.job_title?.trim() || 'Analise sem titulo';

  return (
    <li>
      <article
        data-testid="history-item"
        className="rounded-[18px] border-[3px] border-ink bg-paper p-4 shadow-[6px_6px_0_#111]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3
            data-testid="history-item-title"
            className="font-display text-lg font-extrabold text-ink"
          >
            {title}
          </h3>
          {formattedDate && item.created_at ? (
            <time
              data-testid="history-item-date"
              dateTime={item.created_at}
              className="text-sm text-muted"
            >
              {formattedDate}
            </time>
          ) : null}
        </div>

        {item.company_name ? (
          <p data-testid="history-item-company" className="mt-2 text-sm text-ink">
            Empresa: {item.company_name}
          </p>
        ) : null}

        <p data-testid="history-item-score" className="mt-2 text-sm text-ink">
          Aderencia: {item.match_score}/100
        </p>

        {item.generation_blocked ? (
          <p data-testid="history-item-blocked" className="mt-2 text-sm text-ink">
            {item.blocked_reason
              ? `PDF nao gerado: ${item.blocked_reason}`
              : 'PDF nao gerado.'}
          </p>
        ) : null}

        {item.job_summary ? (
          <p
            data-testid="history-item-summary"
            className="mt-3 text-sm leading-[1.45] text-ink"
          >
            {item.job_summary}
          </p>
        ) : null}

        {item.strengths.length > 0 ? (
          <p className="mt-3 text-sm text-ink">
            Pontos fortes: {item.strengths.join(', ')}
          </p>
        ) : null}

        {item.critical_gaps.length > 0 ? (
          <p className="mt-2 text-sm text-ink">
            Lacunas criticas: {item.critical_gaps.join(', ')}
          </p>
        ) : null}
      </article>
    </li>
  );
}
