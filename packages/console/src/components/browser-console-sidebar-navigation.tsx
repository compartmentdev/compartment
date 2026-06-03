import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { cn } from '../lib/utils';
import type { BrowserConsolePage } from './browser-console-header';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { type LucideIcon } from './ui/icons';

const navigationBadgeBackground: string =
  'linear-gradient(90deg, var(--opacity-primary-lighter) 0%, var(--opacity-primary-lighter) 100%), linear-gradient(90deg, var(--card) 0%, var(--card) 100%)';

export interface BrowserConsoleNavItem {
  badge?: string | undefined;
  href: string;
  icon: LucideIcon;
  label: string;
  page: BrowserConsolePage;
}

export interface BrowserConsoleNavSection {
  items: BrowserConsoleNavItem[];
  title: string;
}

interface BrowserConsoleSidebarNavigationProps {
  currentPage: BrowserConsolePage;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  sections: BrowserConsoleNavSection[];
}

interface BrowserConsoleNavigationSectionProps {
  currentPage: BrowserConsolePage;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  section: BrowserConsoleNavSection;
}

interface BrowserConsoleSectionItemsProps {
  currentPage: BrowserConsolePage;
  items: BrowserConsoleNavItem[];
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

interface BrowserConsoleNavLinkProps {
  active: boolean;
  badge?: string | undefined;
  href: string;
  icon: LucideIcon;
  label: string;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

export function BrowserConsoleSidebarNavigation({
  currentPage,
  onNavigate,
  sections,
}: Readonly<BrowserConsoleSidebarNavigationProps>): JSX.Element {
  return (
    <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col">
      {sections.map((section: BrowserConsoleNavSection): JSX.Element | null => (
        <BrowserConsoleNavigationSection
          currentPage={currentPage}
          key={section.title}
          onNavigate={onNavigate}
          section={section}
        />
      ))}
    </nav>
  );
}

function BrowserConsoleNavigationSection({
  currentPage,
  onNavigate,
  section,
}: Readonly<BrowserConsoleNavigationSectionProps>): JSX.Element | null {
  if (section.items.length === 0) {
    return null;
  }

  return (
    <section className="flex w-full flex-col p-2">
      <p className="flex h-8 w-full items-center px-2 text-[12px] font-medium leading-4 text-sidebar-foreground opacity-70">
        {section.title}
      </p>
      <BrowserConsoleSectionItems currentPage={currentPage} items={section.items} onNavigate={onNavigate} />
    </section>
  );
}

function BrowserConsoleSectionItems({
  currentPage,
  items,
  onNavigate,
}: Readonly<BrowserConsoleSectionItemsProps>): JSX.Element {
  return (
    <div className="flex w-full flex-col">
      {items.map(
        (item: BrowserConsoleNavItem): JSX.Element => (
          <BrowserConsoleNavLink
            active={currentPage === item.page}
            badge={item.badge}
            href={item.href}
            icon={item.icon}
            key={item.href}
            label={item.label}
            onNavigate={onNavigate}
          />
        ),
      )}
    </div>
  );
}

function BrowserConsoleNavLink({
  active,
  badge,
  href,
  icon: Icon,
  label,
  onNavigate,
}: Readonly<BrowserConsoleNavLinkProps>): JSX.Element {
  return (
    <BrowserSoftNavigationLink
      aria-current={active ? 'page' : undefined}
      className={readNavigationLinkClassName(active)}
      href={href}
      onNavigate={onNavigate}
    >
      <BrowserConsoleNavLabel icon={Icon} label={label} />
      {renderNavigationBadge(badge, active)}
    </BrowserSoftNavigationLink>
  );
}

function BrowserConsoleNavLabel({
  icon: Icon,
  label,
}: Readonly<Pick<BrowserConsoleNavLinkProps, 'icon' | 'label'>>): JSX.Element {
  return (
    <span className="flex h-6 min-w-0 items-center gap-2">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate text-[14px] font-normal leading-5">{label}</span>
    </span>
  );
}

function renderNavigationBadge(badge: string | undefined, active: boolean): JSX.Element | null {
  if (badge === undefined) {
    return null;
  }

  if (active) {
    return (
      <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center">
        <span className="inline-flex h-[18px] shrink-0 items-center justify-center rounded-pill bg-primary px-1.5 py-0.5 text-[12px] font-medium leading-4 text-primary-foreground">
          {badge}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center">
      <span
        className="inline-flex h-[18px] shrink-0 items-center justify-center rounded-pill px-1.5 py-0.5 text-[12px] font-medium leading-4 text-primary"
        style={{ backgroundImage: navigationBadgeBackground }}
      >
        {badge}
      </span>
    </span>
  );
}

function readNavigationLinkClassName(active: boolean): string {
  return cn(
    'flex h-9 items-center justify-between gap-2 rounded-control px-2 py-0 no-underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2',
    active
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  );
}
