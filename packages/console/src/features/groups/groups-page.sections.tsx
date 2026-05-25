import type { AccessGroupListRow } from '@compartment/contracts/browser';
import { type JSX, useState } from 'react';
import { BrowserConsoleShell } from '../../components/browser-console-header';
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
      <DismissibleAlert message={state.data.noticeMessage} variant="notice" />
      <DismissibleAlert message={state.data.errorMessage} variant="error" />
      {renderGroupsPageContent(searchQuery, setSearchQuery, state)}
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
      <GroupsPageHeader />
      <GroupsPageToolbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} state={state} />
      <GroupsTableSection groups={readVisibleGroups(state.data.groups, searchQuery)} state={state} />
    </>
  );
}

function GroupsPageHeader(): JSX.Element {
  return <AccessPageHeader title="Groups" />;
}

function GroupsPageToolbar({
  searchQuery,
  setSearchQuery,
  state,
}: Readonly<{ searchQuery: string; setSearchQuery: (value: string) => void; state: GroupsPageState }>): JSX.Element {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <ServerSearch label="Search groups" onSearch={setSearchQuery} placeholder="Search groups" value={searchQuery} />
      {canManageBrowserGroups(state.data.currentOrganizationPermissions) ? (
        <ToolbarPrimaryActionButton
          icon={UsersRound}
          onClick={(): void => {
            state.onNavigate(buildGroupsPageHref(state.data, null, 'create'));
          }}
          type="button"
        >
          Create group
        </ToolbarPrimaryActionButton>
      ) : null}
    </header>
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
