import type { JSX, ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { X } from '../../components/ui/icons';

interface AccessDrawerHeaderProps {
  actions?: ReactNode;
  eyebrow?: string | undefined;
  onClose: () => void;
  subtitle?: string | undefined;
  title: string;
}

export function AccessDrawerHeader({
  actions,
  eyebrow,
  onClose,
  subtitle,
  title,
}: Readonly<AccessDrawerHeaderProps>): JSX.Element {
  const resolvedEyebrow: string | undefined = readDrawerHeaderEyebrow(eyebrow, title);

  return (
    <div className="px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <AccessDrawerHeading eyebrow={resolvedEyebrow} subtitle={subtitle} title={title} />
        <AccessDrawerCloseButton onClose={onClose} />
      </div>
      {actions === undefined ? null : <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function AccessDrawerHeading({
  eyebrow,
  subtitle,
  title,
}: Readonly<Pick<AccessDrawerHeaderProps, 'eyebrow' | 'subtitle' | 'title'>>): JSX.Element {
  return (
    <div className="space-y-1">
      {eyebrow === undefined ? null : (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
      )}
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle === undefined ? null : <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function readDrawerHeaderEyebrow(eyebrow: string | undefined, title: string): string | undefined {
  if (eyebrow === undefined) {
    return 'Control plane';
  }

  return normalizeDrawerHeaderLabel(eyebrow) === normalizeDrawerHeaderLabel(title) ? undefined : eyebrow;
}

function normalizeDrawerHeaderLabel(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function AccessDrawerCloseButton({ onClose }: Readonly<{ onClose: () => void }>): JSX.Element {
  return (
    <Button
      aria-label="Close panel"
      className="size-7 border-0 bg-transparent p-0 hover:bg-muted"
      onClick={onClose}
      size="sm"
      type="button"
      variant="ghost"
    >
      <X className="size-3.5" />
    </Button>
  );
}
