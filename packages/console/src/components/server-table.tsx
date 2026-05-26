import type { JSX, ReactNode } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { cn } from '../lib/utils';

interface ServerTableProps {
  children: ReactNode;
  minWidthClassName: string;
}

interface ServerTableFrameProps {
  children: ReactNode;
  className?: string | undefined;
}

interface ServerTableEmptyRowProps {
  colSpan: number;
  message: string;
}

interface ServerTableActionsProps {
  children: ReactNode;
}

interface ServerTableActionErrorProps {
  message: string | undefined;
}

export interface ServerTableColumnDefinition {
  className?: string | undefined;
  key: string;
}

interface ServerTableColumnGroupProps {
  columns: readonly ServerTableColumnDefinition[];
}

interface ServerTableCellProps {
  align?: 'left' | 'right';
  children: ReactNode;
  className?: string | undefined;
}

interface ServerTableHeadingProps {
  align?: 'left' | 'right';
  className?: string | undefined;
  label: string;
}

interface ServerTableRowProps {
  children: ReactNode;
}

interface ServerTableSortableHeadingProps {
  href: string;
  label: string;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  sortDirection?: 'asc' | 'desc' | undefined;
}

export function ServerTable({ children, minWidthClassName }: Readonly<ServerTableProps>): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn('w-full border-collapse [&_thead_tr]:border-b [&_thead_tr]:border-border', minWidthClassName)}
      >
        {children}
      </table>
    </div>
  );
}

export function ServerTableFrame({ children, className }: Readonly<ServerTableFrameProps>): JSX.Element {
  return (
    <section className={cn('overflow-hidden rounded-lg border border-border bg-[var(--table-surface)]', className)}>
      {children}
    </section>
  );
}

export function ServerTableColumnGroup({ columns }: Readonly<ServerTableColumnGroupProps>): JSX.Element {
  return (
    <colgroup>
      {columns.map(
        (column: ServerTableColumnDefinition): JSX.Element => (
          <col className={column.className} key={column.key} />
        ),
      )}
    </colgroup>
  );
}

export function ServerTableRow({ children }: Readonly<ServerTableRowProps>): JSX.Element {
  return <tr className="border-t border-border align-middle first:border-t-0">{children}</tr>;
}

export function ServerTableCell({ align = 'left', children, className }: Readonly<ServerTableCellProps>): JSX.Element {
  return (
    <td
      className={cn(
        'px-4 py-2.5 text-[13px] text-foreground',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function ServerTableActions({ children }: Readonly<ServerTableActionsProps>): JSX.Element {
  return <div className="flex flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">{children}</div>;
}

export function ServerTableActionError({ message }: Readonly<ServerTableActionErrorProps>): JSX.Element | null {
  if (message === undefined) {
    return null;
  }

  return <p className="max-w-[220px] text-right text-[11px] leading-4 text-[var(--toast-text-error)]">{message}</p>;
}

export function ServerTableHeading({
  align = 'left',
  className,
  label,
}: Readonly<ServerTableHeadingProps>): JSX.Element {
  return (
    <th
      className={cn(
        'px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      scope="col"
    >
      {label}
    </th>
  );
}

export function ServerTableSortableHeading({
  href,
  label,
  onNavigate,
  sortDirection,
}: Readonly<ServerTableSortableHeadingProps>): JSX.Element {
  return (
    <th className="px-4 py-3 text-left" scope="col">
      <BrowserSoftNavigationLink
        className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground no-underline hover:text-foreground"
        href={href}
        onNavigate={onNavigate}
      >
        {label}
        <span className="text-[11px] text-foreground/70">{readSortIndicator(sortDirection)}</span>
      </BrowserSoftNavigationLink>
    </th>
  );
}

export function ServerTableEmptyRow({ colSpan, message }: Readonly<ServerTableEmptyRowProps>): JSX.Element {
  return (
    <tr>
      <td className="px-4 py-10 text-center text-[13px] text-muted-foreground" colSpan={colSpan}>
        {message}
      </td>
    </tr>
  );
}

export function readServerTableActionControlClassName(): string {
  return 'h-7 px-2 text-[12px]';
}

export function readServerTableClosedBadgeClassName(): string {
  return 'inline-flex h-7 items-center rounded-md border border-border bg-muted px-2 text-[12px] text-muted-foreground';
}

function readSortIndicator(sortDirection: 'asc' | 'desc' | undefined): string {
  if (sortDirection === undefined) {
    return '↕';
  }

  return sortDirection === 'asc' ? '↑' : '↓';
}
