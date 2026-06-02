import type { ChangeEvent, JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { Select } from './select';
import { Button, buttonVariants } from './ui/button';
import { ChevronLeft, ChevronRight, type LucideIcon } from './ui/icons';
import { cn } from '../lib/utils';

type PaginationDirection = 'next' | 'previous';

interface ServerTableControlsProps {
  currentPage: number;
  itemLabel: string;
  nextPageHref: string | null;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  onPageSizeChange: (value: string) => void;
  pageSize: string;
  pageSizeOptions: string[];
  previousPageHref: string | null;
  showPageSize?: boolean | undefined;
  totalItems: number;
  totalPages: number;
}

interface PaginationLinkProps {
  ariaLabel: string;
  disabled: boolean;
  direction: PaginationDirection;
  href: string | null;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

interface RowsPerPageSectionProps {
  itemLabel: string;
  onPageSizeChange: (value: string) => void;
  pageSize: string;
  pageSizeOptions: string[];
  showPageSize: boolean;
  totalItems: number;
}

interface PaginationSectionProps {
  currentPage: number;
  nextPageHref: string | null;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  previousPageHref: string | null;
  totalPages: number;
}

interface PaginationButtonGroupProps {
  nextPageHref: string | null;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  previousPageHref: string | null;
}

interface RowsPerPageSelectProps {
  onPageSizeChange: (value: string) => void;
  pageSize: string;
  pageSizeOptions: string[];
}

export function ServerTableControls(props: Readonly<ServerTableControlsProps>): JSX.Element {
  return renderControlsLayout({
    ...props,
    showPageSize: props.showPageSize ?? true,
  });
}

function PaginationLink({
  ariaLabel,
  direction,
  disabled,
  href,
  onNavigate,
}: Readonly<PaginationLinkProps>): JSX.Element {
  const icon: JSX.Element = renderPaginationIcon(direction);

  if (disabled || href === null) {
    return renderDisabledPaginationLink(ariaLabel, icon);
  }

  return renderEnabledPaginationLink(ariaLabel, href, icon, onNavigate);
}

function renderEnabledPaginationLink(
  ariaLabel: string,
  href: string,
  icon: JSX.Element,
  onNavigate: BrowserSoftNavigateHandler | undefined,
): JSX.Element {
  return (
    <BrowserSoftNavigationLink
      aria-label={ariaLabel}
      className={cn(buttonVariants({ size: 'xs', variant: 'outline' }), 'size-6 px-0 no-underline')}
      href={href}
      onNavigate={onNavigate}
    >
      {icon}
    </BrowserSoftNavigationLink>
  );
}

function renderDisabledPaginationLink(ariaLabel: string, icon: JSX.Element): JSX.Element {
  return (
    <Button aria-label={ariaLabel} className="size-6 px-0" disabled size="xs" type="button" variant="outline">
      {icon}
    </Button>
  );
}

function RowsPerPageSection({
  itemLabel,
  onPageSizeChange,
  pageSize,
  pageSizeOptions,
  showPageSize,
  totalItems,
}: Readonly<RowsPerPageSectionProps>): JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-[13px] text-muted-foreground md:flex-row md:items-center md:gap-4">
      <p>{formatItemsCount(totalItems, itemLabel)}</p>
      {showPageSize ? (
        <label className="flex items-center gap-2">
          <span>Rows</span>
          <RowsPerPageSelect
            onPageSizeChange={onPageSizeChange}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
          />
        </label>
      ) : null}
    </div>
  );
}

function PaginationSection({
  currentPage,
  nextPageHref,
  onNavigate,
  previousPageHref,
  totalPages,
}: Readonly<PaginationSectionProps>): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 md:justify-end">
      <p className="text-[13px] text-muted-foreground">
        Page {currentPage} of {totalPages}
      </p>
      <PaginationButtonGroup nextPageHref={nextPageHref} onNavigate={onNavigate} previousPageHref={previousPageHref} />
    </div>
  );
}

function PaginationButtonGroup({
  nextPageHref,
  onNavigate,
  previousPageHref,
}: Readonly<PaginationButtonGroupProps>): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <PaginationLink
        ariaLabel="Previous page"
        disabled={previousPageHref === null}
        direction="previous"
        href={previousPageHref}
        onNavigate={onNavigate}
      />
      <PaginationLink
        ariaLabel="Next page"
        disabled={nextPageHref === null}
        direction="next"
        href={nextPageHref}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function renderPaginationIcon(direction: PaginationDirection): JSX.Element {
  const Icon: LucideIcon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return <Icon aria-hidden="true" className="size-3" />;
}

function RowsPerPageSelect({
  onPageSizeChange,
  pageSize,
  pageSizeOptions,
}: Readonly<RowsPerPageSelectProps>): JSX.Element {
  return (
    <Select
      aria-label="Rows per page"
      className="h-8 min-w-[4.5rem] text-[12px]"
      onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
        onPageSizeChange(event.target.value);
      }}
      value={pageSize}
    >
      {pageSizeOptions.map(
        (option: string): JSX.Element => (
          <option key={option} value={option}>
            {option}
          </option>
        ),
      )}
    </Select>
  );
}

function formatItemsCount(totalItems: number, itemLabel: string): string {
  return `${totalItems} ${itemLabel}${totalItems === 1 ? '' : 's'}`;
}

function renderControlsLayout(props: Readonly<ServerTableControlsProps>): JSX.Element {
  return (
    <div className="flex min-h-9 flex-col gap-3 border-t border-border px-4 py-0 md:flex-row md:items-center md:justify-between">
      <RowsPerPageSection
        itemLabel={props.itemLabel}
        onPageSizeChange={props.onPageSizeChange}
        pageSize={props.pageSize}
        pageSizeOptions={props.pageSizeOptions}
        showPageSize={props.showPageSize ?? true}
        totalItems={props.totalItems}
      />
      <PaginationSection
        currentPage={props.currentPage}
        nextPageHref={props.nextPageHref}
        onNavigate={props.onNavigate}
        previousPageHref={props.previousPageHref}
        totalPages={props.totalPages}
      />
    </div>
  );
}
