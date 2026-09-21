import { AppHeader } from '../components/AppHeader';
import { HistoryPanel } from '../components/HistoryPanel';

export function HistoryPage() {
  return (
    <div
      data-testid="history-page"
      className="mx-auto min-h-dvh max-w-3xl px-5 py-5"
    >
      <AppHeader />
      <HistoryPanel />
    </div>
  );
}
