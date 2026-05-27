import type { AccessRoleListRow, PermissionKey } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Box, Pencil, Trash } from '../../components/ui/icons';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessAdditionalCard, readAccessDangerActionButtonClassName } from '../access/access-additional-card';
import { AccessDrawerCollapsibleSection } from '../access/access-drawer-collapsible-section';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { accessDrawerHeaderActionButtonClassName, AccessDrawerSection } from '../access/access-ui';
import { PermissionFamiliesCard } from '../access/access-permission-families';
import { canManageBrowserRoles } from '../console/console-access';
import {
  handleRoleDelete,
  readRoleDeleteConfirmationSpec,
  type RoleDeleteConfirmationSpec,
} from './roles-page.actions';
import { closeRolesDrawerAfterMutation } from './roles-page.navigation';
import { buildRolesPageHref } from './roles-page.query';
import type { RolesPageState } from './roles-page.state';

interface DeleteRoleActionProps {
  isDialogOpen: boolean;
  isPending: boolean;
  role: AccessRoleListRow;
  setIsDialogOpen: (value: boolean) => void;
}

type RoleDeleteMutation = UseMutationResult<boolean, Error, void>;

export function RoleDetailDrawerHeader({
  role,
  state,
}: Readonly<{ role: AccessRoleListRow; state: RolesPageState }>): JSX.Element {
  return (
    <AccessDrawerDetailHeader
      action={
        role.kind === 'custom' && canManageBrowserRoles(state.data.currentOrganizationPermissions) ? (
          <EditRoleButton roleId={role.id} state={state} />
        ) : undefined
      }
      closeHref={buildRolesPageHref(state.data)}
      eyebrow="Role"
      onNavigate={state.onNavigate}
    />
  );
}

function EditRoleButton({ roleId, state }: Readonly<{ roleId: string; state: RolesPageState }>): JSX.Element {
  return (
    <Button
      className={accessDrawerHeaderActionButtonClassName}
      onClick={(): void => {
        state.onNavigate(buildRolesPageHref(state.data, { mode: 'edit', roleId }));
      }}
      size="sm"
      type="button"
      variant="soft"
    >
      <Pencil className="size-4" />
      Edit
    </Button>
  );
}

export function RoleDetailDrawerContent({
  role,
  state,
}: Readonly<{ role: AccessRoleListRow; state: RolesPageState }>): JSX.Element {
  return (
    <>
      <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
      <RoleSummaryCard role={role} />
      <RolePermissionsCard permissionKeys={role.permissionKeys} />
      {role.kind === 'custom' && canManageBrowserRoles(state.data.currentOrganizationPermissions) ? (
        <RoleAdditionalSection role={role} state={state} />
      ) : null}
    </>
  );
}

function RoleSummaryCard({ role }: Readonly<{ role: AccessRoleListRow }>): JSX.Element {
  return (
    <AccessDrawerSection separated={false}>
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Box className="size-4" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[22px] font-semibold tracking-tight">{role.name}</h3>
            <Badge variant="soft">{role.kind === 'system' ? 'System' : 'Custom'}</Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">{readRoleDescription(role)}</p>
        </div>
      </div>
    </AccessDrawerSection>
  );
}

function RolePermissionsCard({ permissionKeys }: Readonly<{ permissionKeys: PermissionKey[] }>): JSX.Element {
  return (
    <AccessDrawerCollapsibleSection
      defaultExpanded
      summary={`${permissionKeys.length} effective permissions in total`}
      title="Effective permissions"
    >
      <PermissionFamiliesCard permissionKeys={permissionKeys} />
    </AccessDrawerCollapsibleSection>
  );
}

function RoleAdditionalSection({
  role,
  state,
}: Readonly<{ role: AccessRoleListRow; state: RolesPageState }>): JSX.Element {
  return (
    <AccessDrawerSection title="Additional">
      <RoleDangerZone role={role} state={state} />
    </AccessDrawerSection>
  );
}

function RoleDangerZone({ role, state }: Readonly<{ role: AccessRoleListRow; state: RolesPageState }>): JSX.Element {
  return (
    <AccessAdditionalCard
      action={<DeleteRoleButton role={role} state={state} />}
      description="Remove this custom role and revoke its assignments."
      title="Danger zone"
      tone="danger"
    />
  );
}

function DeleteRoleButton({ role, state }: Readonly<{ role: AccessRoleListRow; state: RolesPageState }>): JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const mutation: RoleDeleteMutation = useRoleDeleteMutation(role, state);

  return (
    <>
      <DeleteRoleActionButton isPending={mutation.isPending} setIsDialogOpen={setIsDialogOpen} />
      <DeleteRoleDialog
        isDialogOpen={isDialogOpen}
        isPending={mutation.isPending}
        role={role}
        setIsDialogOpen={setIsDialogOpen}
        onConfirm={(): void => {
          setIsDialogOpen(false);
          mutation.mutate();
        }}
      />
    </>
  );
}

function DeleteRoleActionButton({
  isPending,
  setIsDialogOpen,
}: Readonly<Pick<DeleteRoleActionProps, 'isPending' | 'setIsDialogOpen'>>): JSX.Element {
  return (
    <Button
      className={readAccessDangerActionButtonClassName()}
      disabled={isPending}
      onClick={(): void => setIsDialogOpen(true)}
      size="sm"
      type="button"
      variant="destructive"
    >
      <Trash aria-hidden="true" />
      {isPending ? 'Removing...' : 'Remove role'}
    </Button>
  );
}

function DeleteRoleDialog({
  isDialogOpen,
  isPending,
  role,
  setIsDialogOpen,
  onConfirm,
}: Readonly<DeleteRoleActionProps & { onConfirm: () => void }>): JSX.Element {
  const confirmation: RoleDeleteConfirmationSpec = readRoleDeleteConfirmationSpec(role.name);

  return (
    <ConfirmationDialog
      confirmLabel={confirmation.confirmLabel}
      description={confirmation.description}
      expectedValue={confirmation.expectedValue}
      inputLabel={confirmation.inputLabel}
      inputPlaceholder={confirmation.inputPlaceholder}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={setIsDialogOpen}
      open={isDialogOpen}
      title={confirmation.title}
    />
  );
}

function useRoleDeleteMutation(role: AccessRoleListRow, state: RolesPageState): RoleDeleteMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> =>
      await handleRoleDelete(role, state.data, state.setData, state.setDrawerErrorMessage),
    mutationKey: ['console-access', 'roles', organizationSlug, role.id, 'delete'],
    onSuccess: (didDelete: boolean): void => {
      if (didDelete) {
        closeRolesDrawerAfterMutation(state);
      }
    },
  });
}

function readRoleDescription(role: AccessRoleListRow): string {
  return role.description === null || role.description === '' ? 'No description.' : role.description;
}
