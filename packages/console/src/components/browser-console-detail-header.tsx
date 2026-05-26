import type { CSSProperties, JSX } from 'react';
import { cn } from '../lib/utils';
import type {
  BrowserConsoleDetailIconTone,
  BrowserConsoleDetailTitleProps,
} from './browser-console-detail-header.types';

interface BrowserConsoleEnvironmentBadgeProps {
  label: string;
}

const browserConsoleDetailIconClassName: string = 'inline-flex size-6 items-center justify-center rounded-md border';
const browserConsoleEnvironmentBadgeStyle: CSSProperties = { fontVariationSettings: "'opsz' 14" };

export function BrowserConsoleDetailTitle({
  badgeLabel,
  icon: Icon,
  iconTone,
  title,
}: Readonly<BrowserConsoleDetailTitleProps>): JSX.Element {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <span className={readBrowserConsoleDetailIconClassName(iconTone)}>
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <h1 className="text-2xl font-semibold leading-8 tracking-normal text-foreground">{title}</h1>
      {badgeLabel === undefined ? null : <BrowserConsoleEnvironmentBadge label={badgeLabel} />}
    </div>
  );
}

function BrowserConsoleEnvironmentBadge({ label }: Readonly<BrowserConsoleEnvironmentBadgeProps>): JSX.Element {
  return (
    <span
      aria-label="Environment"
      className="button-soft-surface ml-4 inline-flex h-6 shrink-0 items-center justify-center rounded-[8px] border border-border px-2 py-1 text-[13px] font-semibold leading-5 text-primary"
      style={browserConsoleEnvironmentBadgeStyle}
    >
      {label}
    </span>
  );
}

export function readBrowserConsoleEnvironmentLabel(
  environmentName: string | null | undefined,
  fallbackLabel: string,
): string {
  if (environmentName === null || environmentName === undefined || environmentName.length === 0) {
    return fallbackLabel;
  }

  return `${environmentName.slice(0, 1).toUpperCase()}${environmentName.slice(1)}`;
}

function readBrowserConsoleDetailIconClassName(iconTone: BrowserConsoleDetailIconTone): string {
  return cn(browserConsoleDetailIconClassName, readBrowserConsoleDetailIconToneClassName(iconTone));
}

function readBrowserConsoleDetailIconToneClassName(iconTone: BrowserConsoleDetailIconTone): string {
  switch (iconTone) {
    case 'blue':
      return 'border-[rgb(30_101_172_/_0.4)] bg-[rgb(30_101_172_/_0.2)] text-[rgb(30_101_172)]';
    case 'purple':
      return 'border-[rgb(172_121_245_/_0.34)] bg-[rgb(172_121_245_/_0.18)] text-[rgb(147_87_232)]';
  }
}
