import type { HTMLAttributes, JSX } from 'react';
import { cn } from '../../lib/utils';

export type DotBadgeIconName =
  | 'active'
  | 'archived-queued'
  | 'attention'
  | 'blocked'
  | 'checking-readiness'
  | 'draining-previous'
  | 'failed'
  | 'invited'
  | 'not-deployed'
  | 'release'
  | 'rolled-back'
  | 'starting-candidate'
  | 'stopped'
  | 'succeeded'
  | 'switching'
  | 'system'
  | 'updating';

export type DotBadgeTone = 'destructive' | 'muted' | 'success';

interface DotBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: DotBadgeIconName | undefined;
  label: string;
  tone?: DotBadgeTone | undefined;
}

const statusIconUrls: Record<DotBadgeIconName, string> = {
  active: new URL('../../assets/statuses/active.svg', import.meta.url).href,
  'archived-queued': new URL('../../assets/statuses/archived-queued.svg', import.meta.url).href,
  attention: new URL('../../assets/statuses/attention.svg', import.meta.url).href,
  blocked: new URL('../../assets/statuses/blocked.svg', import.meta.url).href,
  'checking-readiness': new URL('../../assets/statuses/checking-readiness.svg', import.meta.url).href,
  'draining-previous': new URL('../../assets/statuses/draining-previous.svg', import.meta.url).href,
  failed: new URL('../../assets/statuses/failed.svg', import.meta.url).href,
  invited: new URL('../../assets/statuses/invited.svg', import.meta.url).href,
  'not-deployed': new URL('../../assets/statuses/not-deployed.svg', import.meta.url).href,
  release: new URL('../../assets/statuses/release.svg', import.meta.url).href,
  'rolled-back': new URL('../../assets/statuses/rolled-back.svg', import.meta.url).href,
  'starting-candidate': new URL('../../assets/statuses/starting-candidate.svg', import.meta.url).href,
  stopped: new URL('../../assets/statuses/stopped.svg', import.meta.url).href,
  succeeded: new URL('../../assets/statuses/succeeded.svg', import.meta.url).href,
  switching: new URL('../../assets/statuses/switching.svg', import.meta.url).href,
  system: new URL('../../assets/statuses/system.svg', import.meta.url).href,
  updating: new URL('../../assets/statuses/updating.svg', import.meta.url).href,
};

export function DotBadge({ className, icon, label, tone = 'muted', ...props }: Readonly<DotBadgeProps>): JSX.Element {
  return (
    <span className={cn(readDotBadgeClassName(tone), className)} {...props}>
      {icon === undefined ? null : <DotBadgeIcon icon={icon} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

function DotBadgeIcon({ icon }: Readonly<{ icon: DotBadgeIconName }>): JSX.Element {
  return (
    <span aria-hidden="true" className={cn('dot-badge-icon', icon === 'active' ? 'dot-badge-icon-active' : undefined)}>
      <img alt="" className="size-3" draggable={false} src={statusIconUrls[icon]} />
    </span>
  );
}

function readDotBadgeClassName(tone: DotBadgeTone): string {
  return cn(
    "inline-flex max-w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[12px] font-semibold leading-4 [font-variation-settings:'opsz'_14]",
    readDotBadgeToneClassName(tone),
  );
}

function readDotBadgeToneClassName(tone: DotBadgeTone): string {
  switch (tone) {
    case 'destructive':
      return 'text-destructive';
    case 'success':
      return 'text-success';
    case 'muted':
      return 'text-muted-foreground';
  }
}
