import type { AccessGroupListRow } from '@compartment/contracts/browser';
import { type JSX, useState } from 'react';
import {
  BrowserConsoleShell,
  browserConsolePageClassName,
  browserConsolePageHeaderClassName,
  browserConsoleListPageBodyClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ToolbarPrimaryActionButton } from '../../components/toolbar-primary-action';
import { UsersRound } from '../../components/ui/icons';
import { AccessDrawerShell, AccessPageHeader } from '../access/access-ui';
import { canManageBrowserGroups } from '../console/console-access';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import {
  type CreateGroupFormState,
  type CreateGroupMutation,
  CreateGroupDrawerContent,
  CreateGroupDrawerFooter,
  CreateGroupDrawerHeader,
  useCreateGroupFormState,
  useCreateGroupMutation,
} from './groups-page.create-drawer';
import { GroupDrawerHeader } from './groups-page.detail-layout';
import { GroupsEmptyState, shouldRenderGroupsEmptyState } from './groups-empty-state';
import { GroupDetailDrawerContent, useGroupDetailEditingState } from './groups-page.detail-drawer';
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
interface CreateGroupButtonProps {
  showCreateAction: boolean;
  state: GroupsPageState;
}

interface GroupsPageToolbarProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
}

interface GroupsTableSectionProps {
  groups: AccessGroupListRow[];
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
      {state.data.organizationContext.kind === 'selected' ? <GroupsPageDrawer state={state} /> : null}
    </BrowserConsoleShell>
  );
}

function GroupsPageDrawer({ state }: Readonly<GroupsPageContentProps>): JSX.Element | null {
  const { isEditing, setIsEditing } = useGroupDetailEditingState(state.selectedGroup?.id);
  const createFormState: CreateGroupFormState = useCreateGroupFormState(state);
  const createMutation: CreateGroupMutation = useCreateGroupMutation(state, createFormState);
  if (state.data.mode === 'list') {
    return null;
  }
  if (state.data.mode === 'create') {
    return renderGroupsCreateDrawer(state, createFormState, createMutation);
  }
  if (state.selectedGroup === undefined) {
    return null;
  }
  return renderGroupsDetailDrawer(state, isEditing, setIsEditing);
}

function renderGroupsCreateDrawer(
  state: GroupsPageState,
  createFormState: CreateGroupFormState,
  createMutation: CreateGroupMutation,
): JSX.Element {
  return (
    <AccessDrawerShell
      closeHref={buildGroupsPageHref(state.data, null)}
      footer={<CreateGroupDrawerFooter mutation={createMutation} state={state} />}
      header={<CreateGroupDrawerHeader state={state} />}
      onNavigate={state.onNavigate}
      title="Create group"
    >
      <CreateGroupDrawerContent formState={createFormState} mutation={createMutation} state={state} />
    </AccessDrawerShell>
  );
}

function renderGroupsDetailDrawer(
  state: GroupsPageState,
  isEditing: boolean,
  setIsEditing: (value: boolean) => void,
): JSX.Element {
  return (
    <AccessDrawerShell
      closeHref={buildGroupsPageHref(state.data, null)}
      header={<GroupDrawerHeader isEditing={isEditing} setIsEditing={setIsEditing} state={state} />}
      onNavigate={state.onNavigate}
      subtitle="Review membership, shared assignments, and inherited permissions."
      title={state.selectedGroup?.name ?? 'Group'}
    >
      <GroupDetailDrawerContent isEditing={isEditing} setIsEditing={setIsEditing} state={state} />
    </AccessDrawerShell>
  );
}

function GroupsPageBody({ searchQuery, setSearchQuery, state }: Readonly<GroupsPageBodyProps>): JSX.Element {
  const showEmptyState: boolean = shouldRenderGroupsEmptyState(state, searchQuery);
  return (
    <div className={browserConsolePageClassName}>
      <GroupsPageHeader showCreateAction={!showEmptyState} state={state} />
      <div className={browserConsoleListPageBodyClassName}>
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
  const showEmptyState: boolean = shouldRenderGroupsEmptyState(state, searchQuery);
  if (showEmptyState) {
    return <GroupsEmptyState state={state} />;
  }
  const visibleGroups: AccessGroupListRow[] = readVisibleGroups(state.data.groups, searchQuery);
  return (
    <>
      <GroupsPageToolbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <GroupsTableSection groups={visibleGroups} state={state} />
    </>
  );
}

function GroupsPageHeader({ showCreateAction, state }: Readonly<GroupsPageHeaderProps>): JSX.Element {
  return (
    <header className={browserConsolePageHeaderClassName}>
      <AccessPageHeader
        action={<CreateGroupButton showCreateAction={showCreateAction} state={state} />}
        title="Groups"
      />
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

function CreateGroupButton({ showCreateAction, state }: Readonly<CreateGroupButtonProps>): JSX.Element | null {
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

function GroupsTableSection({ groups, state }: Readonly<GroupsTableSectionProps>): JSX.Element {
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
