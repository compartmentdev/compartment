import type { JSX } from 'react';
import type { BrowserConsoleDetailTitleProps } from './browser-console-detail-header.types';
import { Badge } from './ui/badge';
import { IconTile } from './ui/icon-tile';

interface BrowserConsoleEnvironmentBadgeProps {
  label: string;
}

export function BrowserConsoleDetailTitle({
  badgeLabel,
  icon: Icon,
  title,
}: Readonly<BrowserConsoleDetailTitleProps>): JSX.Element {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <IconTile icon={Icon} />
      <h1 className="text-2xl font-semibold leading-8 tracking-normal text-foreground">{title}</h1>
      {badgeLabel === undefined ? null : <BrowserConsoleEnvironmentBadge label={badgeLabel} />}
    </div>
  );
}

function BrowserConsoleEnvironmentBadge({ label }: Readonly<BrowserConsoleEnvironmentBadgeProps>): JSX.Element {
  return (
    <Badge aria-label="Environment" className="ml-4" variant="info">
      {label}
    </Badge>
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
