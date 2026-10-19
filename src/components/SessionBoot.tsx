import { Skeleton } from './ui/skeleton';

/** Skeleton neutro enquanto o refresh do boot não decide a rota. */
export function SessionBoot() {
  return (
    <div
      data-testid="session-boot"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 px-4 py-10"
    >
      <span className="sr-only">Carregando</span>
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="mt-2 h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}
