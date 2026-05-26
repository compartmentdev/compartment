import type { AccessGroupListRow } from '@compartment/contracts/browser';
import { type JSX, useState } from 'react';
import {
  BrowserConsoleShell,
  browserConsolePageBodyClassName,
  browserConsolePageClassName,
  browserConsolePageHeaderClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ToolbarPrimaryActionButton } from '../../components/toolbar-primary-action';
import { UsersRound } from '../../components/ui/icons';
import { AccessPageHeader } from '../access/access-ui';
import { canManageBrowserGroups } from '../console/console-access';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { CreateGroupDrawer } from './groups-page.create-drawer';
import { GroupDetailDrawer } from './groups-page.detail-drawer';
import { buildGroupsHref, buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';
import { GroupsTable, readGroupSearchText } from './groups-page.table';

interface GroupsPageContentProps {
  state: GroupsPageState;
}

export function GroupsPageContent({ state }: Readonly<GroupsPageContentProps>): JSX.Element {
  const [searchQuery, setSearchQuery] = useState<string>('');

  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={state.data.currentOrganizationPermissions}
      organizationControl={readOrganizationControl(state)}
      onNavigate={state.onNavigate}
      page="groups"
      principalEmail={state.data.principalEmail}
      projectCount={state.data.projectCount}
      selectedOrganizationSlug={state.data.selectedOrganizationSlug}
    >
      <GroupsPageBody searchQuery={searchQuery} setSearchQuery={setSearchQuery} state={state} />
      {state.data.organizationContext.kind === 'selected' && state.data.mode === 'create' ? (
        <CreateGroupDrawer state={state} />
      ) : null}
      {state.data.organizationContext.kind === 'selected' &&
      state.selectedGroup !== undefined &&
      state.data.mode === 'detail' ? (
        <GroupDetailDrawer state={state} />
      ) : null}
    </BrowserConsoleShell>
  );
}

function GroupsPageBody({
  searchQuery,
  setSearchQuery,
  state,
}: Readonly<{ searchQuery: string; setSearchQuery: (value: string) => void; state: GroupsPageState }>): JSX.Element {
  return (
    <div className={browserConsolePageClassName}>
      <GroupsPageHeader state={state} />
      <div className={browserConsolePageBodyClassName}>
        <DismissibleAlert message={state.data.noticeMessage} variant="notice" />
        <DismissibleAlert message={state.data.errorMessage} variant="error" />
        {renderGroupsPageContent(searchQuery, setSearchQuery, state)}
      </div>
    </div>
  );
}

function renderGroupsPageContent(
  searchQuery: string,
  setSearchQuery: (value: string) => void,
  state: GroupsPageState,
): JSX.Element {
  if (state.data.organizationContext.kind !== 'selected') {
    return (
      <BrowserConsoleOrganizationContextPanel
        context={state.data.organizationContext}
        onNavigate={state.onNavigate}
        organizations={state.data.organizations}
        readOrganizationHref={(organizationSlug: string): string => buildGroupsHref(organizationSlug, null)}
      />
    );
  }

  return (
    <>
      <GroupsPageToolbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <GroupsTableSection groups={readVisibleGroups(state.data.groups, searchQuery)} state={state} />
    </>
  );
}

function GroupsPageHeader({ state }: Readonly<{ state: GroupsPageState }>): JSX.Element {
  return (
    <header className={browserConsolePageHeaderClassName}>
      <AccessPageHeader
        action={<CreateGroupButton state={state} />}
        description="Manage shared access groups and their members."
        title="Groups"
      />
    </header>
  );
}

function GroupsPageToolbar({
  searchQuery,
  setSearchQuery,
}: Readonly<{ searchQuery: string; setSearchQuery: (value: string) => void }>): JSX.Element {
  return (
    <header>
      <ServerSearch
        className="w-full max-w-none"
        hasLeadingSearchIcon
        label="Search groups"
        onSearch={setSearchQuery}
        placeholder="Search groups"
        value={searchQuery}
      />
    </header>
  );
}

function CreateGroupButton({ state }: Readonly<{ state: GroupsPageState }>): JSX.Element | null {
  if (!canManageBrowserGroups(state.data.currentOrganizationPermissions)) {
    return null;
  }

  return (
    <ToolbarPrimaryActionButton
      icon={UsersRound}
      onClick={(): void => {
        state.onNavigate(buildGroupsPageHref(state.data, null, 'create'));
      }}
      type="button"
      variant="accent"
    >
      Create group
    </ToolbarPrimaryActionButton>
  );
}

function GroupsTableSection({
  groups,
  state,
}: Readonly<{ groups: AccessGroupListRow[]; state: GroupsPageState }>): JSX.Element {
  return (
    <ServerTableFrame>
      <GroupsTable groups={groups} state={state} />
    </ServerTableFrame>
  );
}

function readOrganizationControl(state: GroupsPageState): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    state.data.organizations,
    state.data.selectedOrganizationSlug,
    state.data.showOrganizationSelector,
    (organizationSlug: string): void => {
      state.onNavigate(buildGroupsHref(organizationSlug, null));
    },
  );
}

function readVisibleGroups(groups: AccessGroupListRow[], searchQuery: string): AccessGroupListRow[] {
  const normalizedSearchQuery: string = searchQuery.trim().toLowerCase();
  return groups.filter((group: AccessGroupListRow): boolean =>
    readGroupSearchText(group).includes(normalizedSearchQuery),
  );
}
