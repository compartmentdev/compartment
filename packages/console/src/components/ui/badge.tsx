import type { HTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';

type BadgeVariant = 'default' | 'destructive' | 'info' | 'outline' | 'soft' | 'success';

interface BadgeVariantInput {
  variant?: BadgeVariant | undefined;
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, BadgeVariantInput {}

export function Badge({ className, variant = 'default', ...props }: Readonly<BadgeProps>): JSX.Element {
  return <span className={cn(readBaseBadgeClassName(), readBadgeVariantClassName(variant), className)} {...props} />;
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
    case 'info':
      return "h-6 shrink-0 justify-center rounded-[8px] border border-[var(--opacity-info-lighter)] bg-[var(--opacity-info-lighter)] px-2 py-1 text-[13px] font-semibold leading-5 text-info [font-variation-settings:'opsz'_14]";
    case 'outline':
      return 'border border-border/80 bg-background/70 text-foreground';
    case 'soft':
      return "h-6 shrink-0 justify-center rounded-[8px] border border-[var(--tag-bg-default)] bg-[var(--tag-bg-default)] px-2 py-1 text-[13px] font-semibold leading-5 text-[var(--tag-text-default)] [font-variation-settings:'opsz'_14]";
    case 'success':
      return 'bg-[var(--toast-bg-success)] text-[var(--toast-text-success)]';
  }
}
