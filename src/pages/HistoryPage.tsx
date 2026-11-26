import { Link } from 'react-router-dom';

import { APP_COVER_LETTER } from '../auth/returnTo';
import { AppShell } from '../components/AppShell';
import { HistoryPanel } from '../components/HistoryPanel';

export function HistoryPage() {
  return (
    <AppShell>
      <div data-testid="history-page" className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          <Link
            to={APP_COVER_LETTER}
            data-testid="history-carta-avulsa"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Gerar carta só com a empresa
          </Link>
          , sem analisar a vaga antes.
        </p>
        <HistoryPanel />
      </div>
    </AppShell>
  );
}
