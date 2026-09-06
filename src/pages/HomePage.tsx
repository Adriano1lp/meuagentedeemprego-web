import { useAuth } from '../auth/AuthContext';

export function HomePage() {
  const { user, logout } = useAuth();
  const greeting = user?.display_name?.trim() || user?.email || 'usuario';

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-5 py-5">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-extrabold text-ink">
          Meu Agente de Emprego
        </h1>
        <button
          type="button"
          data-testid="logout-button"
          onClick={logout}
          className="rounded-[18px] border-[3px] border-ink bg-paper px-4 py-2 font-display text-sm font-extrabold shadow-[4px_4px_0_#111]"
        >
          Sair
        </button>
      </header>

      <section
        data-testid="home-shell"
        className="mt-8 rounded-3xl border-[3px] border-ink bg-paper p-6 shadow-[8px_8px_0_#111]"
      >
        <p className="inline-block rounded-full border-[3px] border-ink bg-green px-3 py-1 text-xs font-bold">
          logado
        </p>
        <h2 className="mt-4 font-display text-[32px] font-extrabold text-ink">
          Ola, {greeting}
        </h2>
        <p className="mt-3 text-base leading-[1.45] text-ink">
          Voce esta logado. O W1 cobre autenticacao JWT e aceite de termos /
          privacidade. Curriculo, processar, billing, PDF e exportacao ficam
          para as proximas fatias.
        </p>
      </section>
    </div>
  );
}
