import type { CSSProperties, JSX, ReactNode } from 'react';
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
    <div className={readAccessAdditionalCardClassName(tone)} style={readAccessAdditionalCardStyle(tone)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className={readAccessAdditionalTitleClassName(tone)} style={readAccessAdditionalTitleStyle(tone)}>
            {title}
          </p>
          <p
            className={readAccessAdditionalDescriptionClassName(tone)}
            style={readAccessAdditionalDescriptionStyle(tone)}
          >
            {description}
          </p>
        </div>
        {action === undefined || action === null ? null : <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

export function readAccessDangerActionButtonClassName(): string {
  return 'h-8 gap-1.5 rounded-[10px] px-2.5 text-[13px] leading-5 [&_svg]:size-4';
}

function readAccessAdditionalCardClassName(tone: 'default' | 'danger'): string {
  return cn(
    'rounded-[10px] border p-3 shadow-[0_1px_1px_rgba(0,0,0,0.1)]',
    tone === 'danger'
      ? undefined
      : 'border-[var(--cpt-border-default,rgba(0,0,0,0.08))] bg-[var(--cpt-bg-card,#fafafa)]',
  );
}

function readAccessAdditionalCardStyle(tone: 'default' | 'danger'): CSSProperties | undefined {
  if (tone === 'default') {
    return undefined;
  }

  return {
    backgroundColor: 'var(--sidebar,#fafafa)',
    borderColor: 'rgba(164,46,28,0.1)',
  };
}

function readAccessAdditionalTitleClassName(tone: 'default' | 'danger'): string {
  return cn('text-[13px] font-semibold leading-5', tone === 'danger' ? undefined : 'text-foreground');
}

function readAccessAdditionalTitleStyle(tone: 'default' | 'danger'): CSSProperties | undefined {
  if (tone === 'default') {
    return undefined;
  }

  return {
    color: 'var(--destructive,#c0412c)',
  };
}

function readAccessAdditionalDescriptionClassName(tone: 'default' | 'danger'): string {
  return cn('text-[12px] leading-4', tone === 'danger' ? undefined : 'text-muted-foreground');
}

function readAccessAdditionalDescriptionStyle(tone: 'default' | 'danger'): CSSProperties | undefined {
  if (tone === 'default') {
    return undefined;
  }

  return {
    color: 'rgba(164,46,28,0.6)',
  };
}
