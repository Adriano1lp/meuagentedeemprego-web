import { History, House, LogOut, UserRound, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

type Destination = {
  to: string;
  label: string;
  icon: LucideIcon;
  testId: string;
};

const destinations: Destination[] = [
  { to: '/app', label: 'Inicio', icon: House, testId: 'nav-home' },
  {
    to: '/app/historico',
    label: 'Historico',
    icon: History,
    testId: 'nav-historico',
  },
  { to: '/app/perfil', label: 'Perfil', icon: UserRound, testId: 'nav-perfil' },
];

function DestinationLink({
  item,
  placement,
}: {
  item: Destination;
  placement: 'sidebar' | 'bottom';
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end
      data-testid={placement === 'sidebar' ? item.testId : undefined}
      className={({ isActive }) =>
        placement === 'sidebar'
          ? cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
            )
          : cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-medium',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
      }
    >
      {({ isActive }) => (
        <>
          {placement === 'bottom' ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-3 top-0 h-0.5 rounded-full',
                isActive ? 'bg-primary' : 'bg-transparent',
              )}
            />
          ) : null}
          <Icon aria-hidden="true" className={placement === 'bottom' ? 'size-5' : 'size-4'} />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ onLogout }: { onLogout: () => void }) {
  return (
    <aside
      data-testid="app-sidebar"
      className="fixed top-0 left-0 z-30 hidden h-dvh w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
    >
      <div className="flex items-center gap-3 px-5 pb-4 pt-6">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
        >
          M
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-sidebar-foreground/60">
            MAE
          </p>
          <p className="truncate font-display text-sm font-semibold leading-snug">
            Meu Agente de Emprego
          </p>
        </div>
      </div>
      <nav aria-label="Principal" className="flex flex-1 flex-col gap-1 px-3">
        {destinations.map((item) => (
          <DestinationLink key={item.to} item={item} placement="sidebar" />
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Button
          type="button"
          variant="ghost"
          data-testid="logout-button"
          onClick={onLogout}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut aria-hidden="true" />
          Sair
        </Button>
      </div>
    </aside>
  );
}

function MobileTopBar({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
        >
          M
        </span>
        <p className="truncate font-display text-sm font-semibold">
          Meu Agente de Emprego
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onLogout}
        className="shrink-0"
      >
        <LogOut aria-hidden="true" />
        Sair
      </Button>
    </header>
  );
}

function BottomNav() {
  return (
    <nav
      data-testid="app-bottom-nav"
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background md:hidden"
    >
      <div className="flex h-16">
        {destinations.map((item) => (
          <DestinationLink key={item.to} item={item} placement="bottom" />
        ))}
      </div>
      <div className="app-bottom-nav-safe" aria-hidden="true" />
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { logout } = useAuth();

  return (
    <div className="min-h-dvh bg-transparent text-foreground">
      <h1 className="sr-only">Meu Agente de Emprego</h1>
      <Sidebar onLogout={logout} />
      <div className="flex min-h-dvh min-w-0 flex-col md:pl-64">
        <MobileTopBar onLogout={logout} />
        <main className="app-shell-main mx-auto w-full min-w-0 max-w-3xl flex-1 px-4 pt-6 md:px-8 md:pt-8">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
