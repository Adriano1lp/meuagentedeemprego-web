import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-card-foreground',
      destructive:
        'border-destructive/30 bg-destructive/10 text-foreground',
      success: 'border-primary/25 bg-success text-success-foreground',
      warning: 'border-accent-foreground/15 bg-warning text-warning-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

function Alert({
  className,
  variant,
  role = 'alert',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="alert-title"
      className={cn('font-display text-base font-semibold', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-sm leading-relaxed', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
