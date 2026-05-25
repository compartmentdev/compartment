import type { JSX, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface AccessAdditionalCardProps {
  action?: ReactNode;
  description: string;
  tone?: 'default' | 'danger' | undefined;
  title: string;
}

export function AccessAdditionalCard({
  action,
  description,
  title,
  tone = 'default',
}: Readonly<AccessAdditionalCardProps>): JSX.Element {
  return (
    <div className={readAccessAdditionalCardClassName(tone)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[12px] text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

export function readAccessDangerActionButtonClassName(): string {
  return 'bg-[var(--cpt-button-destructive-bg,#c0412c)] text-white hover:bg-[var(--cpt-button-destructive-bg,#c0412c)]/90';
}

function readAccessAdditionalCardClassName(tone: 'default' | 'danger'): string {
  return cn(
    'rounded-xl px-4 py-3',
    tone === 'danger'
      ? 'border border-[rgba(192,65,44,0.18)] bg-[rgba(192,65,44,0.06)]'
      : 'border border-border bg-background',
  );
}
