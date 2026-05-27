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
  readServerTableActionControlClassName,
} from '../../components/server-table';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { MoreHorizontal } from '../../components/ui/icons';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { formatGroupAccessSummary, formatGroupScopeSummary } from '../access/access-display';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { canManageBrowserGroups } from '../console/console-access';
import {
  handleGroupDeleteAction,
  readGroupDeleteConfirmationSpec,
  type GroupDeleteConfirmationSpec,
} from './groups-page.actions';
import { buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';

interface GroupsTableProps {
  groups: AccessGroupListRow[];
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

export function GroupsTable({ groups, state }: Readonly<GroupsTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[1040px]">
      <thead className="bg-background">
        <tr>
          <ServerTableHeading label="Group" />
          <ServerTableHeading label="Members" />
          <ServerTableHeading label="Access" />
          <ServerTableHeading label="Scope" />
          <ServerTableHeading label="Description" />
          <ServerTableHeading align="right" label="Actions" />
        </tr>
      </thead>
      <tbody>{renderGroupRows(groups, state)}</tbody>
    </ServerTable>
  );
}

export function readGroupSearchText(group: AccessGroupListRow): string {
  return [group.name, group.description ?? '', ...group.assignedRoleNames, ...group.assignmentScopeLabels]
    .join(' ')
    .toLowerCase();
}

function renderGroupRows(groups: AccessGroupListRow[], state: GroupsPageState): JSX.Element[] {
  if (groups.length === 0) {
    return [<ServerTableEmptyRow colSpan={6} key="empty" message="No groups found." />];
  }

  return groups.map(
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
        state.onNavigate(buildGroupsPageHref(state.data, group.id));
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

function GroupActionsTrigger({ group }: Readonly<{ group: AccessGroupListRow }>): JSX.Element {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        aria-label={`Open actions for ${group.name}`}
        className="size-7 px-0 text-muted-foreground"
        size="sm"
        type="button"
        variant="secondary"
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
    </DropdownMenuTrigger>
  );
}

function GroupRemoveMenuItem({
  isPending,
  onSelect,
}: Readonly<{ isPending: boolean; onSelect: () => void }>): JSX.Element {
  return (
    <DropdownMenuItem
      className="text-red-700 focus:text-red-800"
      disabled={isPending}
      onSelect={(): void => {
        if (!isPending) {
          onSelect();
        }
      }}
    >
      {isPending ? 'Removing...' : 'Remove'}
    </DropdownMenuItem>
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

function readGroupDescription(group: AccessGroupListRow): string {
  return group.description === null || group.description === '' ? 'No description' : group.description;
}
