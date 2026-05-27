import type { AccessRoleListRow, PermissionKey } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { ConfirmationDialog } from '../../components/confirmation-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { IconTile } from '../../components/ui/icon-tile';
import { Drama, Pencil, Trash } from '../../components/ui/icons';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessAdditionalCard, readAccessDangerActionButtonClassName } from '../access/access-additional-card';
import { AccessDrawerCollapsibleSection } from '../access/access-drawer-collapsible-section';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import {
  accessDrawerHeaderActionButtonClassName,
  accessDrawerSummaryDescriptionClassName,
  accessDrawerSummaryIdentityClassName,
  accessDrawerSummaryStackClassName,
  accessDrawerSummaryTitleClassName,
  AccessDrawerSection,
  AccessDrawerShell,
} from '../access/access-ui';
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

interface RoleDetailDrawerProps {
  state: RolesPageState;
}

interface DeleteRoleActionProps {
  isDialogOpen: boolean;
  isPending: boolean;
  role: AccessRoleListRow;
  setIsDialogOpen: (value: boolean) => void;
}

type RoleDeleteMutation = UseMutationResult<boolean, Error, void>;
type RoleKind = 'custom' | 'system';
type RoleKindBadgeVariant = 'info' | 'soft';

export function RoleDetailDrawer({ state }: Readonly<RoleDetailDrawerProps>): JSX.Element | null {
  const role: AccessRoleListRow | undefined = readSelectedRole(state);
  if (role === undefined) {
    return null;
  }

  return (
    <AccessDrawerShell
      closeHref={buildRolesPageHref(state.data)}
      header={<RoleDetailHeader role={role} state={state} />}
      onNavigate={state.onNavigate}
      title={role.name}
    >
      <RoleDetailContent role={role} state={state} />
    </AccessDrawerShell>
  );
}

function RoleDetailHeader({ role, state }: Readonly<{ role: AccessRoleListRow; state: RolesPageState }>): JSX.Element {
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

function RoleDetailContent({ role, state }: Readonly<{ role: AccessRoleListRow; state: RolesPageState }>): JSX.Element {
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
      <div className={accessDrawerSummaryStackClassName}>
        <div className={accessDrawerSummaryIdentityClassName}>
          <IconTile icon={Drama} />
          <h3 className={accessDrawerSummaryTitleClassName}>{role.name}</h3>
          <Badge variant={readRoleKindBadgeVariant(role.kind)}>{role.kind === 'system' ? 'System' : 'Custom'}</Badge>
        </div>
        <p className={accessDrawerSummaryDescriptionClassName}>{readRoleDescription(role)}</p>
      </div>
    </AccessDrawerSection>
  );
}

function readRoleKindBadgeVariant(kind: RoleKind): RoleKindBadgeVariant {
  return kind === 'custom' ? 'info' : 'soft';
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

function readSelectedRole(state: RolesPageState): AccessRoleListRow | undefined {
  return state.data.roles.find((role: AccessRoleListRow): boolean => role.id === state.data.roleId);
}

function readRoleDescription(role: AccessRoleListRow): string {
  return role.description === null || role.description === '' ? 'No description.' : role.description;
}
