import type { AccessGroupListRow } from '@compartment/contracts/browser';
import { type JSX, useState } from 'react';
import {
  BrowserConsoleShell,
  browserConsolePageBodyClassName,
  browserConsolePageClassName,
  browserConsolePageHeaderClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { EmptyStateCard } from '../../components/empty-state-card';
import type { EmptyStateCardAction } from '../../components/empty-state-card.types';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ToolbarPrimaryActionButton } from '../../components/toolbar-primary-action';
import { Plus, UsersRound } from '../../components/ui/icons';
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

interface GroupsPageBodyProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  state: GroupsPageState;
}

interface GroupsPageHeaderProps {
  showCreateAction: boolean;
  state: GroupsPageState;
}

interface GroupsPageToolbarProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}

interface GroupsTableSectionProps {
  groups: AccessGroupListRow[];
  showEmptyState: boolean;
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

function GroupsPageBody({ searchQuery, setSearchQuery, state }: Readonly<GroupsPageBodyProps>): JSX.Element {
  return (
    <div className={browserConsolePageClassName}>
      <GroupsPageHeader showCreateAction={!shouldRenderGroupsEmptyState(state, searchQuery)} state={state} />
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

  return renderSelectedGroupsPageContent(searchQuery, setSearchQuery, state);
}

function renderSelectedGroupsPageContent(
  searchQuery: string,
  setSearchQuery: (value: string) => void,
  state: GroupsPageState,
): JSX.Element {
  const visibleGroups: AccessGroupListRow[] = readVisibleGroups(state.data.groups, searchQuery);
  const showEmptyState: boolean = shouldRenderGroupsEmptyState(state, searchQuery);

  return (
    <>
      <GroupsPageToolbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <GroupsTableSection groups={visibleGroups} showEmptyState={showEmptyState} state={state} />
    </>
  );
}

function GroupsPageHeader({ showCreateAction, state }: Readonly<GroupsPageHeaderProps>): JSX.Element {
  return (
    <header className={browserConsolePageHeaderClassName}>
      <AccessPageHeader action={<CreateGroupButton showCreateAction={showCreateAction} state={state} />} title="Groups" />
    </header>
  );
}

function GroupsPageToolbar({ searchQuery, setSearchQuery }: Readonly<GroupsPageToolbarProps>): JSX.Element {
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

function CreateGroupButton({ showCreateAction, state }: Readonly<GroupsPageHeaderProps>): JSX.Element | null {
  if (!showCreateAction || !canManageBrowserGroups(state.data.currentOrganizationPermissions)) {
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

function GroupsTableSection({ groups, showEmptyState, state }: Readonly<GroupsTableSectionProps>): JSX.Element {
  if (showEmptyState) {
    return (
      <EmptyStateCard
        action={readCreateGroupEmptyStateAction(state)}
        icon={UsersRound}
        iconClassName="text-[var(--success)]"
        message="You do not have any groups in the Compartment."
      />
    );
  }

  return (
    <ServerTableFrame>
      <GroupsTable groups={groups} state={state} />
    </ServerTableFrame>
  );
}

function readCreateGroupEmptyStateAction(state: GroupsPageState): EmptyStateCardAction | undefined {
  if (!canManageBrowserGroups(state.data.currentOrganizationPermissions)) {
    return undefined;
  }

  return {
    icon: Plus,
    kind: 'button',
    label: 'Create group',
    onClick: (): void => {
      state.onNavigate(buildGroupsPageHref(state.data, null, 'create'));
    },
  };
}

function shouldRenderGroupsEmptyState(state: GroupsPageState, searchQuery: string): boolean {
  return searchQuery.trim() === '' && state.data.groups.length === 0;
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
