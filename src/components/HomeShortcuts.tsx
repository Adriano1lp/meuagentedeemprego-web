import { FileText, House, ScrollText, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';

import { APP_HISTORY, APP_HOME, APP_PROFILE } from '../auth/returnTo';
import { cn } from '@/lib/utils';

const shortcuts = [
  {
    to: `${APP_HOME}#analise`,
    label: 'Analisar vaga',
    testId: 'shortcut-analisar',
    icon: House,
  },
  {
    to: APP_HISTORY,
    label: 'Carta',
    testId: 'shortcut-carta',
    icon: ScrollText,
  },
  {
    to: APP_HISTORY,
    label: 'Histórico',
    testId: 'shortcut-historico',
    icon: FileText,
  },
  {
    to: APP_PROFILE,
    label: 'Perfil',
    testId: 'shortcut-perfil',
    icon: UserRound,
  },
] as const;

export function HomeShortcuts() {
  return (
    <nav aria-label="Atalhos" data-testid="home-shortcuts" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {shortcuts.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.testId}
            to={item.to}
            data-testid={item.testId}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-sm font-medium text-card-foreground shadow-sm',
              'hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
