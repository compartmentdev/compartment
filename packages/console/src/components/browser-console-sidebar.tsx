import type { PermissionKey } from '@compartment/contracts/browser';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { browserAuditPathname, browserGroupsPathname, browserUsersPathname } from '../browser-public-paths';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import {
  canInviteBrowserUsers,
  canReadBrowserAuditLogs,
  canReadBrowserGroups,
  canReadBrowserUsers,
} from '../features/console/console-access';
import { buildBrowserConsoleHref, buildBrowserConsoleProjectsHref } from '../features/console/console-hrefs';
import type { BrowserConsolePage } from './browser-console-header';
import type { BrowserConsoleErrorHandler } from './browser-console.types';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import {
  BrowserConsoleSidebarNavigation,
  type BrowserConsoleNavItem,
  type BrowserConsoleNavSection,
} from './browser-console-sidebar-navigation';
import { BrowserConsoleUserBlock } from './browser-console-user-menu';
import { DismissibleAlert } from './dismissible-alert';
import { Box, type LucideIcon } from './ui/icons';
import {
  SidebarAuditLogsIcon as AuditLogsIcon,
  SidebarGroupsIcon as GroupsIcon,
  SidebarUsersIcon as UsersIcon,
} from './ui/sidebar-navigation-icons';

const compartmentSidebarLogoUrl: string = new URL('../assets/compartment-sidebar-logo.svg', import.meta.url).href;

const sidebarLogoMaskStyle: CSSProperties = {
  WebkitMaskImage: `url(${compartmentSidebarLogoUrl})`,
  WebkitMaskPosition: 'center',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskSize: 'contain',
  maskImage: `url(${compartmentSidebarLogoUrl})`,
  maskPosition: 'center',
  maskRepeat: 'no-repeat',
  maskSize: 'contain',
};

interface BrowserConsoleSidebarProps {
  currentOrganizationPermissions: PermissionKey[];
  errorMessage: string | undefined;
  onError: BrowserConsoleErrorHandler;
  organizationControl?: JSX.Element | null;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  page: BrowserConsolePage;
  principalEmail: string;
  projectCount?: number | undefined;
  selectedOrganizationSlug: string | null;
}

interface BrowserConsoleSidebarLayoutProps {
  errorMessage: string | undefined;
  onError: BrowserConsoleErrorHandler;
  organizationControl: JSX.Element | null;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  page: BrowserConsolePage;
  principalEmail: string;
  sections: BrowserConsoleNavSection[];
  selectedOrganizationSlug: string | null;
}

interface BrowserConsoleSidebarFooterProps {
  errorMessage: string | undefined;
  onError: BrowserConsoleErrorHandler;
  organizationControl: JSX.Element | null;
  principalEmail: string;
}

interface BrowserConsoleSidebarBrandProps {
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  selectedOrganizationSlug: string | null;
}

interface BrowserConsoleSidebarPanelProps {
  children: ReactNode;
}

export function BrowserConsoleSidebar(props: Readonly<BrowserConsoleSidebarProps>): JSX.Element {
  const sections: BrowserConsoleNavSection[] = readNavigationSections(
    props.currentOrganizationPermissions,
    props.projectCount,
    props.selectedOrganizationSlug,
  );

  return (
    <BrowserConsoleSidebarLayout
      errorMessage={props.errorMessage}
      onError={props.onError}
      onNavigate={props.onNavigate}
      organizationControl={props.organizationControl ?? null}
      page={props.page}
      principalEmail={props.principalEmail}
      sections={sections}
      selectedOrganizationSlug={props.selectedOrganizationSlug}
    />
  );
}

function BrowserConsoleSidebarLayout(props: Readonly<BrowserConsoleSidebarLayoutProps>): JSX.Element {
  return (
    <aside className="w-full border-b border-sidebar-border bg-transparent lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
      <BrowserConsoleSidebarPanel>
        <BrowserConsoleSidebarContent {...props} />
      </BrowserConsoleSidebarPanel>
    </aside>
  );
}

function BrowserConsoleSidebarContent(props: Readonly<BrowserConsoleSidebarLayoutProps>): JSX.Element {
  return (
    <>
      <BrowserConsoleSidebarBrand
        onNavigate={props.onNavigate}
        selectedOrganizationSlug={props.selectedOrganizationSlug}
      />
      <BrowserConsoleSidebarNavigation
        currentPage={props.page}
        onNavigate={props.onNavigate}
        sections={props.sections}
      />
      <BrowserConsoleSidebarFooter
        errorMessage={props.errorMessage}
        onError={props.onError}
        organizationControl={props.organizationControl}
        principalEmail={props.principalEmail}
      />
    </>
  );
}

function BrowserConsoleSidebarPanel({ children }: Readonly<BrowserConsoleSidebarPanelProps>): JSX.Element {
  return <div className="flex h-full w-full flex-col">{children}</div>;
}

function BrowserConsoleSidebarBrand({
  onNavigate,
  selectedOrganizationSlug,
}: Readonly<BrowserConsoleSidebarBrandProps>): JSX.Element {
  return (
    <div className="p-2">
      <BrowserSoftNavigationLink
        className="flex w-full items-center gap-2 rounded-md p-2 text-sidebar-foreground no-underline"
        href={buildBrowserConsoleProjectsHref(selectedOrganizationSlug)}
        onNavigate={onNavigate}
      >
        <BrowserConsoleSidebarBrandIcon />
        <span className="min-w-0 truncate text-[20px] font-medium leading-5">Compartment</span>
      </BrowserSoftNavigationLink>
    </div>
  );
}

function BrowserConsoleSidebarBrandIcon(): JSX.Element {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-input text-primary">
      <span aria-hidden="true" className="block size-4 bg-current" style={sidebarLogoMaskStyle} />
    </span>
  );
}

function BrowserConsoleSidebarFooter({
  errorMessage,
  onError,
  organizationControl,
  principalEmail,
}: Readonly<BrowserConsoleSidebarFooterProps>): JSX.Element {
  return (
    <div className="mt-auto flex flex-col gap-0 p-2">
      {organizationControl === null ? null : (
        <div className="p-2 [&_label]:w-full [&_select]:min-w-0 [&_select]:w-full [&_select]:border-sidebar-border [&_select]:bg-background [&_select]:text-sidebar-foreground [&_span]:w-full">
          {organizationControl}
        </div>
      )}
      <BrowserConsoleUserBlock onError={onError} principalEmail={principalEmail} />
      <DismissibleAlert message={errorMessage} variant="error" />
    </div>
  );
}

function readNavigationSections(
  currentOrganizationPermissions: PermissionKey[],
  projectCount: number | undefined,
  selectedOrganizationSlug: string | null,
): BrowserConsoleNavSection[] {
  return [
    {
      items: [
        {
          badge: projectCount === undefined ? undefined : String(projectCount),
          href: buildBrowserConsoleProjectsHref(selectedOrganizationSlug),
          icon: Box,
          label: 'Projects',
          page: 'projects',
        },
      ],
      title: 'Workspace',
    },
    {
      items: readSecurityNavigationItems(currentOrganizationPermissions, selectedOrganizationSlug),
      title: 'Security & Permissions',
    },
  ];
}

function readSecurityNavigationItems(
  currentOrganizationPermissions: PermissionKey[],
  selectedOrganizationSlug: string | null,
): BrowserConsoleNavItem[] {
  const items: BrowserConsoleNavItem[] = [];

  if (canReadBrowserUsers(currentOrganizationPermissions) || canInviteBrowserUsers(currentOrganizationPermissions)) {
    items.push(readSecurityNavigationItem(browserUsersPathname, selectedOrganizationSlug, UsersIcon, 'Users', 'users'));
  }
  if (canReadBrowserGroups(currentOrganizationPermissions)) {
    items.push(
      readSecurityNavigationItem(browserGroupsPathname, selectedOrganizationSlug, GroupsIcon, 'Groups', 'groups'),
    );
  }
  if (canReadBrowserAuditLogs(currentOrganizationPermissions)) {
    items.push(
      readSecurityNavigationItem(browserAuditPathname, selectedOrganizationSlug, AuditLogsIcon, 'Audit logs', 'audit'),
    );
  }

  return items;
}

function readSecurityNavigationItem(
  pathname: string,
  selectedOrganizationSlug: string | null,
  icon: LucideIcon,
  label: string,
  page: BrowserConsolePage,
): BrowserConsoleNavItem {
  return {
    href: buildBrowserConsoleHref(pathname, selectedOrganizationSlug),
    icon,
    label,
    page,
  };
}
