import type { JSX } from 'react';
import { cn } from '../lib/utils';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { Button, buttonVariants } from './ui/button';
import type { LucideIcon } from './ui/icons';
import type {
  EmptyStateCardActionControlProps,
  EmptyStateCardIcon as EmptyStateCardIconValue,
  EmptyStateCardProps,
} from './empty-state-card.types';

interface EmptyStateCardIconProps {
  readonly className?: string | undefined;
  readonly icon: EmptyStateCardIconValue;
}

export function EmptyStateCard({
  action,
  className,
  icon,
  iconClassName,
  message,
}: Readonly<EmptyStateCardProps>): JSX.Element {
  return (
    <section
      className={cn(
        'flex min-h-[420px] w-full flex-1 items-center justify-center rounded-[10px] border border-border px-6 py-16 shadow-[0_1px_2px_0_rgba(0,0,0,0.10)] md:min-h-[560px] lg:min-h-[640px]',
        className,
      )}
    >
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        <EmptyStateCardIcon className={iconClassName} icon={icon} />
        <p className="text-[13px] font-medium leading-5 text-muted-foreground">{message}</p>
        {action === undefined ? null : <EmptyStateCardActionControl action={action} />}
      </div>
    </section>
  );
}

function EmptyStateCardIcon({ className, icon }: Readonly<EmptyStateCardIconProps>): JSX.Element {
  if (typeof icon === 'string') {
    return <img alt="" aria-hidden="true" className={cn('size-8 shrink-0', className)} src={icon} />;
  }

  const Icon: LucideIcon = icon;

  return (
    <Icon
      aria-hidden="true"
      className={cn('size-8 text-muted-foreground opacity-[0.72]', className)}
      strokeWidth={1.6}
    />
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
