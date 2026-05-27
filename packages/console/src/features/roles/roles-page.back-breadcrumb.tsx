import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { ArrowLeft } from '../../components/ui/icons';
import type { RolesBackLink } from './roles-page.query';

interface RolesBackBreadcrumbProps {
  backLink: RolesBackLink | null;
  onNavigate: BrowserSoftNavigateHandler;
}

export function RolesBackBreadcrumb({ backLink, onNavigate }: Readonly<RolesBackBreadcrumbProps>): JSX.Element | null {
  if (backLink === null) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="overflow-x-auto">
      <ol className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <li className="flex min-w-0 items-center gap-1.5">
          <BrowserSoftNavigationLink
            className="inline-flex items-center gap-1 truncate transition-colors hover:text-foreground focus-visible:text-foreground"
            href={backLink.href}
            onNavigate={onNavigate}
            title={backLink.label}
          >
            <ArrowLeft aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{backLink.label}</span>
          </BrowserSoftNavigationLink>
        </li>
      </ol>
    </nav>
  );
}
