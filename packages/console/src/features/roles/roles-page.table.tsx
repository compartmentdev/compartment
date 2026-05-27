import type { AccessRoleListRow } from '@compartment/contracts/browser';
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
import { ServerTableActionsMenu } from '../../components/server-table-actions-menu';
import { Button } from '../../components/ui/button';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { formatRolePermissionSummary, formatRoleUsageSummary } from '../access/access-display';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { canManageBrowserRoles } from '../console/console-access';
import {
  handleRoleDelete,
  readRoleDeleteConfirmationSpec,
  type RoleDeleteConfirmationSpec,
} from './roles-page.actions';
import { buildRolesPageHref } from './roles-page.query';
import type { RolesPageState } from './roles-page.state';

interface RolesTableProps {
  roles: AccessRoleListRow[];
  state: RolesPageState;
}

interface RoleRowProps {
  role: AccessRoleListRow;
  state: RolesPageState;
}

interface RoleDeleteDialogProps {
  isOpen: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  roleName: string;
}

type RoleDeleteMutation = UseMutationResult<boolean, Error, void>;

export function RolesTable({ roles, state }: Readonly<RolesTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[980px]">
      <thead className="bg-background">
        <tr>
          <ServerTableHeading label="Role" />
          <ServerTableHeading label="Type" />
          <ServerTableHeading label="Permissions" />
          <ServerTableHeading label="Used by" />
          <ServerTableHeading label="Description" />
          <ServerTableHeading align="right" label="Actions" />
        </tr>
      </thead>
      <tbody>{renderRoleRows(roles, state)}</tbody>
    </ServerTable>
  );
}

function renderRoleRows(roles: AccessRoleListRow[], state: RolesPageState): JSX.Element[] {
  if (roles.length === 0) {
    return [<ServerTableEmptyRow colSpan={6} key="empty" message="No roles found." />];
  }

  return roles.map((role: AccessRoleListRow): JSX.Element => <RoleRow key={role.id} role={role} state={state} />);
}

function RoleRow({ role, state }: Readonly<RoleRowProps>): JSX.Element {
  return (
    <ServerTableRow>
      <ServerTableCell className="font-medium">{role.name}</ServerTableCell>
      <ServerTableCell>{role.kind === 'system' ? 'System' : 'Custom'}</ServerTableCell>
      <ServerTableCell>{formatRolePermissionSummary(role)}</ServerTableCell>
      <ServerTableCell>{formatRoleUsageSummary(role)}</ServerTableCell>
      <ServerTableCell className="max-w-[280px] text-muted-foreground">{readRoleDescription(role)}</ServerTableCell>
      <ServerTableCell align="right">
        <RoleRowActions role={role} state={state} />
      </ServerTableCell>
    </ServerTableRow>
  );
}

function RoleRowActions({ role, state }: Readonly<RoleRowProps>): JSX.Element {
  const [actionErrorMessage, setActionErrorMessage] = useState<string | undefined>(undefined);

  useEffect((): void => {
    setActionErrorMessage(undefined);
  }, [role.id]);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <ServerTableActions>
        <ViewRoleButton role={role} state={state} />
        {role.kind !== 'system' && canManageBrowserRoles(state.data.currentOrganizationPermissions) ? (
          <RoleRowActionsMenu role={role} setErrorMessage={setActionErrorMessage} state={state} />
        ) : null}
      </ServerTableActions>
      <ServerTableActionError message={actionErrorMessage} />
    </div>
  );
}

function ViewRoleButton({ role, state }: Readonly<RoleRowProps>): JSX.Element {
  return (
    <Button
      className={readServerTableActionControlClassName()}
      onClick={(): void => {
        state.onNavigate(buildRolesPageHref(state.data, { mode: 'detail', roleId: role.id }));
      }}
      size="sm"
      type="button"
      variant="secondary"
    >
      View
    </Button>
  );
}

function RoleRowActionsMenu({
  role,
  setErrorMessage,
  state,
}: Readonly<RoleRowProps & { setErrorMessage: (value: string | undefined) => void }>): JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const mutation: RoleDeleteMutation = useRoleDeleteMutation(role, setErrorMessage, state);

  return (
    <>
      <RoleActionsMenuDropdown isPending={mutation.isPending} roleName={role.name} onRequestDelete={setIsDialogOpen} />
      <RoleDeleteDialog
        isOpen={isDialogOpen}
        isPending={mutation.isPending}
        onConfirm={(): void => {
          setIsDialogOpen(false);
          mutation.mutate();
        }}
        onOpenChange={setIsDialogOpen}
        roleName={role.name}
      />
    </>
  );
}

function RoleActionsMenuDropdown({
  isPending,
  onRequestDelete,
  roleName,
}: Readonly<{ isPending: boolean; onRequestDelete: (open: boolean) => void; roleName: string }>): JSX.Element {
  return (
    <ServerTableActionsMenu ariaLabel={`Open actions for ${roleName}`}>
      <RoleRemoveMenuItem isPending={isPending} onSelect={(): void => onRequestDelete(true)} />
    </ServerTableActionsMenu>
  );
}

function RoleDeleteDialog({
  isOpen,
  isPending,
  onConfirm,
  onOpenChange,
  roleName,
}: Readonly<RoleDeleteDialogProps>): JSX.Element {
  const confirmation: RoleDeleteConfirmationSpec = readRoleDeleteConfirmationSpec(roleName);

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

function RoleRemoveMenuItem({
  isPending,
  onSelect,
}: Readonly<{ isPending: boolean; onSelect: () => void }>): JSX.Element {
  return (
    <DropdownMenuItem
      className="text-destructive focus:text-destructive data-[highlighted]:text-destructive"
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

function useRoleDeleteMutation(
  role: AccessRoleListRow,
  setErrorMessage: (value: string | undefined) => void,
  state: RolesPageState,
): RoleDeleteMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> => await handleRoleDelete(role, state.data, state.setData, setErrorMessage),
    mutationKey: ['console-access', 'roles', organizationSlug, role.id, 'delete'],
    onSuccess: (didDelete: boolean): void => {
      if (didDelete) {
        state.onNavigate(buildRolesPageHref(state.data));
      }
    },
  });
}

function readRoleDescription(role: AccessRoleListRow): string {
  return role.description === null || role.description === '' ? 'No description' : role.description;
}
