import type { JSX } from 'react';
import { cn } from '../lib/utils';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { Button, buttonVariants } from './ui/button';
import type { LucideIcon } from './ui/icons';
import type { EmptyStateCardActionControlProps, EmptyStateCardProps } from './empty-state-card.types';

export function EmptyStateCard({
  action,
  className,
  icon: Icon,
  iconClassName,
  message,
}: Readonly<EmptyStateCardProps>): JSX.Element {
  return (
    <section
      className={cn(
        'flex min-h-[420px] items-center justify-center rounded-lg border border-border bg-[var(--table-surface)] px-6 py-16 shadow-sm md:min-h-[560px] lg:min-h-[640px]',
        className,
      )}
    >
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        <Icon aria-hidden="true" className={cn('size-9 text-muted-foreground', iconClassName)} strokeWidth={1.6} />
        <p className="text-[13px] font-medium leading-5 text-muted-foreground">{message}</p>
        {action === undefined ? null : <EmptyStateCardActionControl action={action} />}
      </div>
    </section>
  );
}

function EmptyStateCardActionControl({ action }: Readonly<EmptyStateCardActionControlProps>): JSX.Element {
  const Icon: LucideIcon = action.icon;
  const content: JSX.Element = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{action.label}</span>
    </>
  );

  if (action.kind === 'link') {
    return (
      <BrowserSoftNavigationLink
        className={buttonVariants({ className: 'no-underline', size: 'lg', variant: 'accent' })}
        href={action.href}
        onNavigate={action.onNavigate}
      >
        {content}
      </BrowserSoftNavigationLink>
    );
  }

  return (
    <Button onClick={action.onClick} size="lg" type="button" variant="accent">
      {content}
    </Button>
  );
}
