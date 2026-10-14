import { AppShell } from '../components/AppShell';
import { HistoryPanel } from '../components/HistoryPanel';

export function HistoryPage() {
  return (
    <AppShell>
      <div data-testid="history-page">
        <HistoryPanel />
      </div>
    </AppShell>
  );
}
