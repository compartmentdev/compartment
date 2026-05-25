import type { HTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';

type BadgeVariant = 'default' | 'destructive' | 'outline' | 'success';

interface BadgeVariantInput {
  variant?: BadgeVariant | undefined;
}

interface BadgeProps extends HTMLAttributes<HTMLDivElement>, BadgeVariantInput {}

export function Badge({ className, variant = 'default', ...props }: Readonly<BadgeProps>): JSX.Element {
  return <div className={cn(readBaseBadgeClassName(), readBadgeVariantClassName(variant), className)} {...props} />;
}

function readBaseBadgeClassName(): string {
  return 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors';
}

function readBadgeVariantClassName(variant: BadgeVariant): string {
  switch (variant) {
    case 'default':
      return 'bg-secondary text-secondary-foreground';
    case 'destructive':
      return 'bg-[var(--toast-bg-error)] text-[var(--toast-text-error)]';
    case 'outline':
      return 'border border-border/80 bg-background/70 text-foreground';
    case 'success':
      return 'bg-[var(--toast-bg-success)] text-[var(--toast-text-success)]';
  }
}
