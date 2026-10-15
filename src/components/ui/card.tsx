import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col gap-1.5 px-5 pt-5 md:px-6 md:pt-6', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="card-title"
      className={cn(
        'font-display text-2xl font-semibold tracking-tight text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-5 pb-5 md:px-6 md:pb-6', className)}
      {...props}
    />
  );
}

export { Card, CardContent, CardDescription, CardHeader, CardTitle };
