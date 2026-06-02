import type { JSX } from 'react';
import {
  BrowserConsoleShell,
  browserConsolePageClassName,
  browserConsolePageHeaderClassName,
  browserConsoleListPageBodyClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ServerTableControls } from '../../components/server-table-controls';
import { ToolbarPrimaryActionButton } from '../../components/toolbar-primary-action';
import { UsersRound } from '../../components/ui/icons';
import { readBrowserTablePageSize } from '../../lib/server-table-query';
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
import { GroupsTable } from './groups-page.table';

interface GroupsPageContentProps {
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

interface GroupsTableSectionProps {
  state: GroupsPageState;
}

export function GroupsPageContent({ state }: Readonly<GroupsPageContentProps>): JSX.Element {
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
      <GroupsPageBody state={state} />
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

function GroupsPageBody({ state }: Readonly<GroupsPageContentProps>): JSX.Element {
  const showEmptyState: boolean = shouldRenderGroupsEmptyState(state);
  return (
    <div className={browserConsolePageClassName}>
      <GroupsPageHeader showCreateAction={!showEmptyState} state={state} />
      <div className={browserConsoleListPageBodyClassName}>
        <DismissibleAlert message={state.data.noticeMessage} variant="notice" />
        <DismissibleAlert message={state.data.errorMessage} variant="error" />
        {renderGroupsPageContent(state)}
      </div>
    </div>
  );
}

function renderGroupsPageContent(state: GroupsPageState): JSX.Element {
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

  if (shouldRenderGroupsEmptyState(state)) {
    return <GroupsEmptyState state={state} />;
  }

  return (
    <>
      <GroupsPageToolbar state={state} />
      <GroupsTableSection state={state} />
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

function GroupsPageToolbar({ state }: Readonly<GroupsPageContentProps>): JSX.Element {
  return (
    <header>
      <ServerSearch
        className="w-full max-w-none"
        hasLeadingSearchIcon
        label="Search groups"
        onSearch={(searchQuery: string): void => {
          state.onNavigate(
            buildGroupsPageHref(state.data, state.data.selectedGroupId, state.data.mode, { page: 1, searchQuery }),
          );
        }}
        placeholder="Search groups"
        value={state.data.searchQuery}
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
    >
      Create group
    </ToolbarPrimaryActionButton>
  );
}

function GroupsTableSection({ state }: Readonly<GroupsTableSectionProps>): JSX.Element {
  return (
    <ServerTableFrame>
      <GroupsTable state={state} />
      <ServerTableControls
        currentPage={state.data.page}
        itemLabel="group"
        nextPageHref={readNextPageHref(state)}
        onNavigate={state.onNavigate}
        onPageSizeChange={(value: string): void => {
          state.onNavigate(readGroupsPageSizeChangeHref(state, value));
        }}
        pageSize={String(state.data.pageSize)}
        pageSizeOptions={state.data.pageSizeOptions.map(String)}
        previousPageHref={readPreviousPageHref(state)}
        totalItems={state.data.totalGroups}
        totalPages={state.data.totalPages}
      />
    </ServerTableFrame>
  );
}

function readGroupsPageSizeChangeHref(state: GroupsPageState, value: string): string {
  return buildGroupsPageHref(state.data, state.data.selectedGroupId, state.data.mode, {
    page: 1,
    pageSize: readBrowserTablePageSize(value),
  });
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

function readNextPageHref(state: GroupsPageState): string | null {
  return state.data.page < state.data.totalPages
    ? buildGroupsPageHref(state.data, state.data.selectedGroupId, state.data.mode, { page: state.data.page + 1 })
    : null;
}

function readPreviousPageHref(state: GroupsPageState): string | null {
  return state.data.page > 1
    ? buildGroupsPageHref(state.data, state.data.selectedGroupId, state.data.mode, { page: state.data.page - 1 })
    : null;
}
