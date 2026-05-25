import type { JSX, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface AccessDrawerListProps {
  children: ReactNode;
}

interface AccessDrawerListEmptyProps {
  message: string;
}

interface AccessDrawerListRowProps {
  children: ReactNode;
  className?: string | undefined;
}

export function AccessDrawerList({ children }: Readonly<AccessDrawerListProps>): JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-[8px] border border-[var(--cpt-border-default,rgba(0,0,0,0.08))] bg-[var(--cpt-bg-card,#fbfcfc)]"
      role="list"
    >
      {children}
    </div>
  );
}

export function AccessDrawerListEmpty({ message }: Readonly<AccessDrawerListEmptyProps>): JSX.Element {
  return <div className="px-3 py-3 text-[13px] text-muted-foreground">{message}</div>;
}

export function AccessDrawerListRow({ children, className }: Readonly<AccessDrawerListRowProps>): JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-2 border-t border-[var(--cpt-border-default,rgba(0,0,0,0.08))] px-3 py-[7px] first:border-t-0 md:items-center',
        className,
      )}
      role="listitem"
    >
      {children}
    </div>
  );
}
