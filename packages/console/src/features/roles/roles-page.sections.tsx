import type { AccessRoleListRow } from '@compartment/contracts/browser';
import { type JSX, useState } from 'react';
import { BrowserConsoleShell } from '../../components/browser-console-header';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ToolbarPrimaryActionButton } from '../../components/toolbar-primary-action';
import { ArrowLeft, ShieldPlus } from '../../components/ui/icons';
import { AccessPageHeader } from '../access/access-ui';
import { canManageBrowserRoles } from '../console/console-access';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { RoleDetailDrawer } from './roles-page.detail-drawer';
import { RoleEditorDrawer } from './roles-page.drawer';
import {
  buildRolesOrganizationHref,
  buildRolesPageHref,
  readRoleSearchText,
  type RolesBackLink,
  readRolesBackLink,
} from './roles-page.query';
import type { RolesPageState } from './roles-page.state';
import { RolesTable } from './roles-page.table';

interface RolesPageContentProps {
  state: RolesPageState;
}

export function RolesPageContent({ state }: Readonly<RolesPageContentProps>): JSX.Element {
  const [searchQuery, setSearchQuery] = useState<string>('');

  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={state.data.currentOrganizationPermissions}
      organizationControl={readOrganizationControl(state)}
      onNavigate={state.onNavigate}
      page="roles"
      principalEmail={state.data.principalEmail}
      selectedOrganizationSlug={state.data.selectedOrganizationSlug}
    >
      <RolesPageBody searchQuery={searchQuery} setSearchQuery={setSearchQuery} state={state} />
      {state.data.organizationContext.kind === 'selected' ? <RolesPageDrawer state={state} /> : null}
    </BrowserConsoleShell>
  );
}

function RolesPageDrawer({ state }: Readonly<RolesPageContentProps>): JSX.Element | null {
  if (state.data.mode === 'list') {
    return null;
  }
  if (state.data.mode === 'detail') {
    return <RoleDetailDrawer state={state} />;
  }
  if (!canManageBrowserRoles(state.data.currentOrganizationPermissions)) {
    return null;
  }

  return <RoleEditorDrawer state={state} />;
}

function RolesPageBody({
  searchQuery,
  setSearchQuery,
  state,
}: Readonly<{ searchQuery: string; setSearchQuery: (value: string) => void; state: RolesPageState }>): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
      <DismissibleAlert message={state.data.noticeMessage} variant="notice" />
      <DismissibleAlert message={state.data.errorMessage} variant="error" />
      {renderRolesPageContent(searchQuery, setSearchQuery, state)}
    </div>
  );
}

function renderRolesPageContent(
  searchQuery: string,
  setSearchQuery: (value: string) => void,
  state: RolesPageState,
): JSX.Element {
  if (state.data.organizationContext.kind !== 'selected') {
    return (
      <BrowserConsoleOrganizationContextPanel
        context={state.data.organizationContext}
        onNavigate={state.onNavigate}
        organizations={state.data.organizations}
        readOrganizationHref={(organizationSlug: string): string => buildRolesOrganizationHref(organizationSlug)}
      />
    );
  }

  return (
    <>
      <RolesPageHeader state={state} />
      <RolesPageToolbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} state={state} />
      <RolesTableSection roles={readVisibleRoles(state.data.roles, searchQuery)} state={state} />
    </>
  );
}

function RolesPageHeader({ state }: Readonly<RolesPageContentProps>): JSX.Element {
  const backLink: RolesBackLink | null = readRolesBackLink(state.data.backHref, state.data.selectedOrganizationSlug);

  return (
    <header className="flex flex-col gap-3">
      {renderRolesBackBreadcrumb(backLink, state)}
      <AccessPageHeader title="Roles" />
    </header>
  );
}

function renderRolesBackBreadcrumb(
  backLink: RolesBackLink | null,
  state: Readonly<RolesPageState>,
): JSX.Element | null {
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
            onNavigate={state.onNavigate}
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

function RolesPageToolbar({
  searchQuery,
  setSearchQuery,
  state,
}: Readonly<{ searchQuery: string; setSearchQuery: (value: string) => void; state: RolesPageState }>): JSX.Element {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <ServerSearch label="Search roles" onSearch={setSearchQuery} placeholder="Search roles" value={searchQuery} />
      {canManageBrowserRoles(state.data.currentOrganizationPermissions) ? (
        <ToolbarPrimaryActionButton
          icon={ShieldPlus}
          onClick={(): void => {
            state.onNavigate(buildRolesPageHref(state.data, { mode: 'create' }));
          }}
          type="button"
        >
          Create role
        </ToolbarPrimaryActionButton>
      ) : null}
    </header>
  );
}

function RolesTableSection({
  roles,
  state,
}: Readonly<{ roles: AccessRoleListRow[]; state: RolesPageState }>): JSX.Element {
  return (
    <ServerTableFrame>
      <RolesTable roles={roles} state={state} />
    </ServerTableFrame>
  );
}

function readOrganizationControl(state: RolesPageState): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    state.data.organizations,
    state.data.selectedOrganizationSlug,
    state.data.showOrganizationSelector,
    (organizationSlug: string): void => {
      state.onNavigate(buildRolesOrganizationHref(organizationSlug));
    },
  );
}

function readVisibleRoles(roles: AccessRoleListRow[], searchQuery: string): AccessRoleListRow[] {
  const normalizedSearchQuery: string = searchQuery.trim().toLowerCase();
  return roles.filter((role: AccessRoleListRow): boolean => readRoleSearchText(role).includes(normalizedSearchQuery));
}
