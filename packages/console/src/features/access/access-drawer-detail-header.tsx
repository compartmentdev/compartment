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
  const hasStackedHeading: boolean = title !== undefined || (description !== undefined && description !== null);

  return (
    <div className="border-b border-border px-4 py-3">
      <div className={readDetailHeaderRowClassName(hasStackedHeading)}>
        <AccessDrawerDetailHeading
          description={description}
          eyebrow={eyebrow}
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
  Pick<AccessDrawerDetailHeaderProps, 'description' | 'eyebrow' | 'title'> & { hasStackedHeading: boolean }
>): JSX.Element {
  return (
    <div className={hasStackedHeading ? 'space-y-1' : undefined}>
      {title === undefined ? (
        <CompactDetailHeading eyebrow={eyebrow} />
      ) : (
        <StackedDetailHeading eyebrow={eyebrow} title={title} />
      )}
      {description === undefined || description === null ? null : (
        <p className="text-[13px] text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function CompactDetailHeading({ eyebrow }: Readonly<Pick<AccessDrawerDetailHeaderProps, 'eyebrow'>>): JSX.Element {
  return (
    <p className="text-[18px] font-semibold leading-[26px] tracking-[-0.03em] text-[var(--cpt-text-secondary,#485259)]">
      {eyebrow}
    </p>
  );
}

function StackedDetailHeading({
  eyebrow,
  title,
}: Readonly<Pick<AccessDrawerDetailHeaderProps, 'eyebrow' | 'title'>>): JSX.Element {
  return (
    <>
      <p className="text-[12px] font-semibold leading-4 text-[var(--cpt-text-muted,#8f98a1)]">{eyebrow}</p>
      <h2 className="text-lg font-semibold">{title}</h2>
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
        className="h-[27px] w-8 border-transparent bg-transparent px-0 hover:bg-accent"
        onClick={closeDrawer}
        size="sm"
        type="button"
        variant="outline"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function readDetailHeaderRowClassName(hasStackedHeading: boolean): string {
  return hasStackedHeading ? 'flex items-start justify-between gap-4' : 'flex items-center justify-between gap-4';
}
