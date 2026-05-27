import type { AccessGroupListRow } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { useEffect, useState, type JSX } from 'react';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import {
  ServerTable,
  ServerTableActionError,
  ServerTableActions,
  ServerTableCell,
  ServerTableEmptyRow,
  ServerTableHeading,
  ServerTableRow,
  ServerTableSortableHeading,
  readServerTableActionControlClassName,
} from '../../components/server-table';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent } from '../../components/ui/dropdown-menu';
import { useBrowserMutation } from '../../lib/browser-query-client';
import type { BrowserGroupsPageResult, BrowserGroupsSortBy } from '../../services/browser-groups.service.types';
import { formatGroupAccessSummary, formatGroupScopeSummary } from '../access/access-display';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { canManageBrowserGroups } from '../console/console-access';
import {
  handleGroupDeleteAction,
  readGroupDeleteConfirmationSpec,
  type GroupDeleteConfirmationSpec,
} from './groups-page.actions';
import { buildGroupsPageHref, readNextGroupsSortDirection } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';
import { GroupActionsTrigger, GroupRemoveMenuItem, readGroupDescription } from './groups-page.table.controls';

interface GroupsTableProps {
  state: GroupsPageState;
}
interface GroupsSortableHeadingProps {
  data: BrowserGroupsPageResult;
  label: string;
  sortBy: BrowserGroupsSortBy;
  state: GroupsPageState;
}
interface GroupRowProps {
  group: AccessGroupListRow;
  state: GroupsPageState;
}
interface GroupDeleteDialogProps {
  groupName: string;
  isOpen: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}
type GroupDeleteMutation = UseMutationResult<boolean, Error, void>;

export function GroupsTable({ state }: Readonly<GroupsTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[1040px]">
      <thead className="bg-background">
        <tr>
          <GroupsSortableHeading data={state.data} label="Group" sortBy="name" state={state} />
          <GroupsSortableHeading data={state.data} label="Members" sortBy="memberCount" state={state} />
          <GroupsSortableHeading data={state.data} label="Access" sortBy="assignmentCount" state={state} />
          <ServerTableHeading label="Scope" />
          <ServerTableHeading label="Description" />
          <ServerTableHeading align="right" label="Actions" />
        </tr>
      </thead>
      <tbody>{renderGroupRows(state)}</tbody>
    </ServerTable>
  );
}
function GroupsSortableHeading({ data, label, sortBy, state }: Readonly<GroupsSortableHeadingProps>): JSX.Element {
  return (
    <ServerTableSortableHeading
      href={buildGroupsPageHref(data, data.selectedGroupId, data.mode, {
        page: 1,
        sortBy,
        sortDirection: readNextGroupsSortDirection(data, sortBy),
      })}
      label={label}
      onNavigate={state.onNavigate}
      sortDirection={data.sortBy === sortBy ? data.sortDirection : undefined}
    />
  );
}

function renderGroupRows(state: GroupsPageState): JSX.Element[] {
  if (state.data.groups.length === 0) {
    return [<ServerTableEmptyRow colSpan={6} key="empty" message="No groups found." />];
  }

  return state.data.groups.map(
    (group: AccessGroupListRow): JSX.Element => <GroupRow group={group} key={group.id} state={state} />,
  );
}
function GroupRow({ group, state }: Readonly<GroupRowProps>): JSX.Element {
  return (
    <ServerTableRow>
      <ServerTableCell className="font-medium">{group.name}</ServerTableCell>
      <ServerTableCell>{group.memberCount}</ServerTableCell>
      <ServerTableCell>{formatGroupAccessSummary(group)}</ServerTableCell>
      <ServerTableCell>{formatGroupScopeSummary(group)}</ServerTableCell>
      <ServerTableCell className="max-w-[260px] text-muted-foreground">{readGroupDescription(group)}</ServerTableCell>
      <ServerTableCell align="right">
        <GroupRowActions group={group} state={state} />
      </ServerTableCell>
    </ServerTableRow>
  );
}
function GroupRowActions({ group, state }: Readonly<GroupRowProps>): JSX.Element {
  const [actionErrorMessage, setActionErrorMessage] = useState<string | undefined>(undefined);

  useEffect((): void => {
    setActionErrorMessage(undefined);
  }, [group.id]);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <ServerTableActions>
        <ManageGroupButton group={group} state={state} />
        {canManageBrowserGroups(state.data.currentOrganizationPermissions) ? (
          <GroupRowActionsMenu group={group} setErrorMessage={setActionErrorMessage} state={state} />
        ) : null}
      </ServerTableActions>
      <ServerTableActionError message={actionErrorMessage} />
    </div>
  );
}
function ManageGroupButton({ group, state }: Readonly<GroupRowProps>): JSX.Element {
  return (
    <Button
      className={readServerTableActionControlClassName()}
      onClick={(): void => {
        state.onNavigate(buildGroupsPageHref(state.data, group.id, 'detail'));
      }}
      size="sm"
      type="button"
      variant="secondary"
    >
      Manage
    </Button>
  );
}
function GroupRowActionsMenu({
  group,
  setErrorMessage,
  state,
}: Readonly<GroupRowProps & { setErrorMessage: (value: string | undefined) => void }>): JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const mutation: GroupDeleteMutation = useGroupDeleteMutation(group, setErrorMessage, state);

  return (
    <>
      <GroupActionsDropdown isPending={mutation.isPending} group={group} onRequestDelete={setIsDialogOpen} />
      <GroupDeleteDialog
        groupName={group.name}
        isOpen={isDialogOpen}
        isPending={mutation.isPending}
        onConfirm={(): void => {
          setIsDialogOpen(false);
          mutation.mutate();
        }}
        onOpenChange={setIsDialogOpen}
      />
    </>
  );
}
function GroupActionsDropdown({
  group,
  isPending,
  onRequestDelete,
}: Readonly<{ group: AccessGroupListRow; isPending: boolean; onRequestDelete: (open: boolean) => void }>): JSX.Element {
  return (
    <DropdownMenu>
      <GroupActionsTrigger group={group} />
      <DropdownMenuContent align="end">
        <GroupRemoveMenuItem isPending={isPending} onSelect={(): void => onRequestDelete(true)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function GroupDeleteDialog({
  groupName,
  isOpen,
  isPending,
  onConfirm,
  onOpenChange,
}: Readonly<GroupDeleteDialogProps>): JSX.Element {
  const confirmation: GroupDeleteConfirmationSpec = readGroupDeleteConfirmationSpec(groupName);

  return (
    <ConfirmationDialog
      confirmLabel={confirmation.confirmLabel}
      description={confirmation.description}
      expectedValue={confirmation.expectedValue}
      inputLabel={confirmation.inputLabel}
      inputPlaceholder={confirmation.inputPlaceholder}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={isOpen}
      title={confirmation.title}
    />
  );
}
function useGroupDeleteMutation(
  group: AccessGroupListRow,
  setErrorMessage: (value: string | undefined) => void,
  state: GroupsPageState,
): GroupDeleteMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> =>
      await handleGroupDeleteAction(state.data, group.id, state.setData, setErrorMessage),
    mutationKey: ['console-access', 'groups', organizationSlug, group.id, 'delete'],
    onSuccess: (didDelete: boolean): void => {
      if (didDelete) {
        state.onNavigate(buildGroupsPageHref(state.data, null));
      }
    },
  });
}
