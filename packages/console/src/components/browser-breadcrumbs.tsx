import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { cn } from '../lib/utils';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import type { BrowserBreadcrumbItem } from './browser-breadcrumbs.types';

interface BrowserBreadcrumbsProps {
  className?: string | undefined;
  items: BrowserBreadcrumbItem[];
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

interface BrowserBreadcrumbEntryProps {
  isCurrent: boolean;
  item: BrowserBreadcrumbItem;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

export function BrowserBreadcrumbs({
  className,
  items,
  onNavigate,
}: Readonly<BrowserBreadcrumbsProps>): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className={cn('overflow-x-auto', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium leading-5 text-muted-foreground">
        {items.map((item: BrowserBreadcrumbItem, index: number): JSX.Element => {
          const isCurrent: boolean = index === items.length - 1;

          return (
            <li className="flex min-w-0 items-center gap-1.5" key={readBrowserBreadcrumbKey(item, index)}>
              {index === 0 ? null : <span aria-hidden="true">/</span>}
              <BrowserBreadcrumbEntry isCurrent={isCurrent} item={item} onNavigate={onNavigate} />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function BrowserBreadcrumbEntry({ isCurrent, item, onNavigate }: Readonly<BrowserBreadcrumbEntryProps>): JSX.Element {
  if (isCurrent || item.href === undefined) {
    return (
      <span aria-current={isCurrent ? 'page' : undefined} className="truncate text-foreground" title={item.label}>
        {item.label}
      </span>
    );
  }

  return (
    <BrowserSoftNavigationLink
      className="truncate transition-colors hover:text-foreground focus-visible:text-foreground"
      href={item.href}
      onNavigate={onNavigate}
      title={item.label}
    >
      {item.label}
    </BrowserSoftNavigationLink>
  );
}

function readBrowserBreadcrumbKey(item: Readonly<BrowserBreadcrumbItem>, index: number): string {
  return item.href === undefined ? `${item.label}-${index}` : `${item.href}-${index}`;
}
