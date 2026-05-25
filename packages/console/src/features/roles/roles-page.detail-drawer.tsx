import type { AccessRoleListRow, PermissionKey } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import type { JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Box } from '../../components/ui/icons';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessAdditionalCard, readAccessDangerActionButtonClassName } from '../access/access-additional-card';
import { AccessDrawerCollapsibleSection } from '../access/access-drawer-collapsible-section';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { AccessDrawerSection, AccessDrawerShell } from '../access/access-ui';
import { PermissionFamiliesCard } from '../access/access-permission-families';
import { canManageBrowserRoles } from '../console/console-access';
import { handleRoleDelete, readRoleDeleteConfirmationMessage } from './roles-page.actions';
import { closeRolesDrawerAfterMutation } from './roles-page.navigation';
import { buildRolesPageHref } from './roles-page.query';
import type { RolesPageState } from './roles-page.state';

interface RoleDetailDrawerProps {
  state: RolesPageState;
}

type RoleDeleteMutation = UseMutationResult<boolean, Error, void>;

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
      panelClassName="max-w-[760px]"
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
      className="h-7 px-2 text-[12px]"
      onClick={(): void => {
        state.onNavigate(buildRolesPageHref(state.data, { mode: 'edit', roleId }));
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      Edit role
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
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Box className="size-4" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[22px] font-semibold tracking-tight">{role.name}</h3>
            <Badge variant={role.kind === 'system' ? 'outline' : 'default'}>
              {role.kind === 'system' ? 'System' : 'Custom'}
            </Badge>
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
  const mutation: RoleDeleteMutation = useRoleDeleteMutation(role, state);

  return (
    <Button
      className={readAccessDangerActionButtonClassName()}
      disabled={mutation.isPending}
      onClick={createRoleDeleteHandler(role.name, mutation)}
      size="sm"
      type="button"
      variant="outline"
    >
      {mutation.isPending ? 'Removing...' : 'Remove role'}
    </Button>
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

function createRoleDeleteHandler(roleName: string, mutation: RoleDeleteMutation): () => void {
  return (): void => {
    if (mutation.isPending || window.prompt(readRoleDeleteConfirmationMessage(roleName)) !== roleName) {
      return;
    }

    mutation.mutate();
  };
}

function readSelectedRole(state: RolesPageState): AccessRoleListRow | undefined {
  return state.data.roles.find((role: AccessRoleListRow): boolean => role.id === state.data.roleId);
}

function readRoleDescription(role: AccessRoleListRow): string {
  return role.description === null || role.description === '' ? 'No description.' : role.description;
}
