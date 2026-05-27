import type { JSX, ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { Button } from '../../components/ui/button';
import { X } from '../../components/ui/icons';
import { useAccessDrawerCloseNavigation } from './access-ui';

interface AccessDrawerDetailHeaderProps {
  action?: ReactNode;
  closeHref: string;
  description?: string | null | undefined;
  eyebrow: string;
  onNavigate: BrowserSoftNavigateHandler;
  title?: string | undefined;
}

export function AccessDrawerDetailHeader({
  action,
  closeHref,
  description,
  eyebrow,
  onNavigate,
  title,
}: Readonly<AccessDrawerDetailHeaderProps>): JSX.Element {
  const closeDrawer: () => void = useAccessDrawerCloseNavigation(closeHref, onNavigate);
  const resolvedEyebrow: string | undefined = readDrawerDetailEyebrow(eyebrow, title);
  const hasStackedHeading: boolean = title !== undefined || (description !== undefined && description !== null);

  return (
    <div className="flex h-[60px] items-center px-4 py-4">
      <div className={readDetailHeaderRowClassName(hasStackedHeading)}>
        <AccessDrawerDetailHeading
          description={description}
          eyebrow={resolvedEyebrow}
          hasStackedHeading={hasStackedHeading}
          title={title}
        />
        <AccessDrawerDetailActions action={action} closeDrawer={closeDrawer} />
      </div>
    </div>
  );
}

function AccessDrawerDetailHeading({
  description,
  eyebrow,
  hasStackedHeading,
  title,
}: Readonly<
  Pick<AccessDrawerDetailHeaderProps, 'description' | 'title'> & {
    eyebrow?: string | undefined;
    hasStackedHeading: boolean;
  }
>): JSX.Element {
  return (
    <div className={hasStackedHeading ? 'min-w-0 space-y-1' : 'min-w-0'}>
      {title === undefined ? (
        <CompactDetailHeading eyebrow={eyebrow ?? 'Control plane'} />
      ) : (
        <StackedDetailHeading eyebrow={eyebrow} title={title} />
      )}
      {description === undefined || description === null ? null : (
        <p className="text-[13px] text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function CompactDetailHeading({ eyebrow }: Readonly<{ eyebrow: string }>): JSX.Element {
  return <p className="truncate text-[16px] font-medium leading-6 tracking-normal text-foreground">{eyebrow}</p>;
}

function StackedDetailHeading({
  eyebrow,
  title,
}: Readonly<Pick<AccessDrawerDetailHeaderProps, 'title'> & { eyebrow?: string | undefined }>): JSX.Element {
  return (
    <>
      {eyebrow === undefined ? null : (
        <p className="text-[12px] font-semibold leading-4 text-muted-foreground">{eyebrow}</p>
      )}
      <h2 className="truncate text-[16px] font-medium leading-6 text-foreground">{title}</h2>
    </>
  );
}

function AccessDrawerDetailActions({
  action,
  closeDrawer,
}: Readonly<{ action: ReactNode | undefined; closeDrawer: () => void }>): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {action}
      <Button
        aria-label="Close panel"
        className="size-7 border-0 bg-transparent p-0 text-foreground hover:bg-muted"
        onClick={closeDrawer}
        size="sm"
        type="button"
        variant="ghost"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function readDetailHeaderRowClassName(hasStackedHeading: boolean): string {
  return hasStackedHeading
    ? 'flex w-full items-start justify-between gap-4'
    : 'flex w-full items-center justify-between gap-4';
}

function readDrawerDetailEyebrow(eyebrow: string, title: string | undefined): string | undefined {
  if (title === undefined) {
    return eyebrow;
  }

  return normalizeDrawerDetailLabel(eyebrow) === normalizeDrawerDetailLabel(title) ? undefined : eyebrow;
}

function normalizeDrawerDetailLabel(value: string): string {
  return value.trim().toLocaleLowerCase();
}
