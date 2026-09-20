import { Link, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

function navClass(active: boolean, accent: string): string {
  return `rounded-[18px] border-[3px] border-ink px-4 py-2 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] ${
    active ? accent : 'bg-paper'
  }`;
}

export function AppHeader() {
  const { logout } = useAuth();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const isHistorico = location.pathname === '/historico';

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="font-display text-xl font-extrabold text-ink">
        Meu Agente de Emprego
      </h1>
      <nav
        aria-label="Principal"
        className="flex flex-wrap items-center gap-2"
      >
        <Link
          to="/"
          data-testid="nav-home"
          aria-current={isHome ? 'page' : undefined}
          className={navClass(isHome, 'bg-green')}
        >
          Inicio
        </Link>
        <Link
          to="/historico"
          data-testid="nav-historico"
          aria-current={isHistorico ? 'page' : undefined}
          className={navClass(isHistorico, 'bg-sky')}
        >
          Historico
        </Link>
      </nav>
      <button
        type="button"
        data-testid="logout-button"
        onClick={logout}
        className="rounded-[18px] border-[3px] border-ink bg-paper px-4 py-2 font-display text-sm font-extrabold shadow-[4px_4px_0_#111]"
      >
        Sair
      </button>
    </header>
  );
}
