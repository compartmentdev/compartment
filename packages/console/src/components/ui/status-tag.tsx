import type { HTMLAttributes, JSX } from 'react';
import { DotBadge, type DotBadgeIconName, type DotBadgeTone } from './dot-badge';

export type StatusTagVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error';
export type StatusTagIconName = DotBadgeIconName;

interface StatusTagProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: StatusTagIconName | undefined;
  label: string;
  showDot?: boolean | undefined;
  variant: StatusTagVariant;
}

export function StatusTag({
  className,
  icon,
  label,
  showDot = false,
  style,
  variant,
  ...props
}: Readonly<StatusTagProps>): JSX.Element {
  return (
    <DotBadge
      className={className}
      icon={icon ?? readFallbackIcon(variant, showDot)}
      label={label}
      style={style}
      tone={readStatusTagTone(variant)}
      {...props}
    />
  );
}

function readStatusTagTone(variant: StatusTagVariant): DotBadgeTone {
  switch (variant) {
    case 'success':
      return 'success';
    case 'warning':
    case 'error':
      return 'destructive';
    case 'default':
    case 'primary':
    case 'secondary':
      return 'muted';
  }
}

function readFallbackIcon(variant: StatusTagVariant, showDot: boolean): DotBadgeIconName | undefined {
  if (!showDot) {
    return undefined;
  }

  switch (variant) {
    case 'success':
      return 'active';
    case 'warning':
      return 'attention';
    case 'error':
      return 'failed';
    case 'primary':
      return 'updating';
    case 'secondary':
      return 'invited';
    case 'default':
      return 'not-deployed';
  }
}
