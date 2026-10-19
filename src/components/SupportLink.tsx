import type { ComponentProps, ReactNode } from 'react';

import { supportMailto } from '../config/support';
import { cn } from '@/lib/utils';

type SupportLinkProps = Omit<ComponentProps<'a'>, 'href' | 'children'> & {
  children: ReactNode;
};

export function SupportLink({ className, children, ...props }: SupportLinkProps) {
  return (
    <a
      {...props}
      href={supportMailto()}
      className={cn(
        'inline-flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-md text-sm font-medium break-words text-primary underline-offset-4 hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {children}
    </a>
  );
}
