import { type AccessGroupListRow, type PermissionKey } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { type JSX, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessAdditionalCard, readAccessDangerActionButtonClassName } from '../access/access-additional-card';
import { AccessDrawerCollapsibleSection } from '../access/access-drawer-collapsible-section';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { AccessDrawerSection, AccessDrawerShell } from '../access/access-ui';
import { PermissionFamiliesCard } from '../access/access-permission-families';
import { canManageBrowserGroups, canManageBrowserRoles, canReadBrowserRoles } from '../console/console-access';
import { ManageRolesButton } from '../roles/manage-roles-button';
import { handleGroupDeleteAction, readGroupDeleteConfirmationMessage } from './groups-page.actions';
import { GroupAssignmentsCard } from './groups-page.assignments';
import { GroupDrawerHeader, GroupSummaryCard } from './groups-page.detail-layout';
import { GroupMembersCard } from './groups-page.members';
import { buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';

interface GroupDetailDrawerProps {
  state: GroupsPageState;
}

type DeleteGroupMutation = UseMutationResult<boolean, Error, void>;

export function GroupDetailDrawer({ state }: Readonly<GroupDetailDrawerProps>): JSX.Element {
  const effectivePermissions: PermissionKey[] = readGroupEffectivePermissions(state);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  useEffect((): void => {
    setIsEditing(false);
  }, [state.selectedGroup?.id]);

  return (
    <AccessDrawerShell
      closeHref={buildGroupsPageHref(state.data, null)}
      header={<GroupDrawerHeader isEditing={isEditing} setIsEditing={setIsEditing} state={state} />}
      onNavigate={state.onNavigate}
      panelClassName="max-w-[920px]"
      subtitle="Review membership, shared assignments, and inherited permissions."
      title={state.selectedGroup?.name ?? 'Group'}
    >
      <GroupDrawerContent
        effectivePermissions={effectivePermissions}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        state={state}
      />
    </AccessDrawerShell>
  );
}

function GroupDrawerContent({
  effectivePermissions,
  isEditing,
  setIsEditing,
  state,
}: Readonly<{
  effectivePermissions: PermissionKey[];
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  state: GroupsPageState;
}>): JSX.Element | null {
  if (state.selectedGroup === undefined) {
    return null;
  }

  return (
    <>
      <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
      <GroupSummaryCard isEditing={isEditing} setIsEditing={setIsEditing} state={state} />
      {canReadGroupRoleData(state) ? <GroupAssignmentsSection state={state} /> : null}
      <GroupMembersSection state={state} />
      {canReadGroupRoleData(state) ? <GroupPermissionsCard permissionKeys={effectivePermissions} /> : null}
      <GroupAdditionalSection state={state} />
    </>
  );
}

function canReadGroupRoleData(state: GroupsPageState): boolean {
  return canReadBrowserRoles(state.data.currentOrganizationPermissions);
}

function GroupAssignmentsSection({ state }: Readonly<GroupDetailDrawerProps>): JSX.Element {
  const selectedGroup: AccessGroupListRow = requireSelectedGroup(state);
  return (
    <GroupAssignmentsCard
      actions={readGroupAssignmentsActions(state)}
      canManageRoles={canManageBrowserRoles(state.data.currentOrganizationPermissions)}
      data={state.data}
      environmentValues={state.environmentValues}
      groupAssignments={state.groupAssignments}
      projectNames={state.projectNames}
      roleId={state.roleId}
      scopeType={state.scopeType}
      selectedGroup={selectedGroup}
      setData={state.setData}
      setErrorMessage={state.setDrawerErrorMessage}
      setEnvironmentValues={state.setEnvironmentValues}
      setProjectNames={state.setProjectNames}
      setRoleId={state.setRoleId}
      setScopeType={state.setScopeType}
    />
  );
}

function readGroupAssignmentsActions(state: GroupsPageState): JSX.Element | undefined {
  return canReadBrowserRoles(state.data.currentOrganizationPermissions) ? (
    <ManageRolesButton onNavigate={state.onNavigate} organizationSlug={state.data.selectedOrganizationSlug} />
  ) : undefined;
}

function GroupMembersSection({ state }: Readonly<GroupDetailDrawerProps>): JSX.Element {
  const selectedGroup: AccessGroupListRow = requireSelectedGroup(state);
  return (
    <GroupMembersCard
      canManageGroups={canManageBrowserGroups(state.data.currentOrganizationPermissions)}
      data={state.data}
      groupId={selectedGroup.id}
      memberEmail={state.memberEmail}
      members={state.data.members}
      setData={state.setData}
      setErrorMessage={state.setDrawerErrorMessage}
      setMemberEmail={state.setMemberEmail}
    />
  );
}

function GroupPermissionsCard({ permissionKeys }: Readonly<{ permissionKeys: PermissionKey[] }>): JSX.Element {
  return (
    <AccessDrawerCollapsibleSection
      defaultExpanded={false}
      description="Resulting access from group + direct assignments"
      summary={`${permissionKeys.length} effective permissions in total`}
      title="Effective permissions"
    >
      <PermissionFamiliesCard permissionKeys={permissionKeys} />
    </AccessDrawerCollapsibleSection>
  );
}

function GroupAdditionalSection({ state }: Readonly<GroupDetailDrawerProps>): JSX.Element | null {
  if (!canManageBrowserGroups(state.data.currentOrganizationPermissions)) {
    return null;
  }

  return (
    <AccessDrawerSection title="Additional">
      <AccessAdditionalCard
        action={<DeleteGroupButton state={state} />}
        description="Delete group and reset permissions for people in the group."
        title="Danger zone"
        tone="danger"
      />
    </AccessDrawerSection>
  );
}

function DeleteGroupButton({ state }: Readonly<GroupDetailDrawerProps>): JSX.Element {
  const mutation: DeleteGroupMutation = useDeleteGroupMutation(state);
  const selectedGroup: AccessGroupListRow = requireSelectedGroup(state);

  return (
    <Button
      className={readAccessDangerActionButtonClassName()}
      disabled={mutation.isPending}
      onClick={createDeleteGroupHandler(selectedGroup.name, mutation)}
      size="sm"
      type="button"
      variant="outline"
    >
      {mutation.isPending ? 'Deleting...' : 'Delete group'}
    </Button>
  );
}

function useDeleteGroupMutation(state: GroupsPageState): DeleteGroupMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  const selectedGroup: AccessGroupListRow = requireSelectedGroup(state);
  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> =>
      await handleGroupDeleteAction(state.data, selectedGroup.id, state.setData, state.setDrawerErrorMessage),
    mutationKey: ['console-access', 'groups', organizationSlug, selectedGroup.id, 'delete'],
    onSuccess: (didDelete: boolean): void => {
      if (didDelete) {
        state.onNavigate(buildGroupsPageHref(state.data, null));
      }
    },
  });
}

function requireSelectedGroup(state: GroupsPageState): AccessGroupListRow {
  if (state.selectedGroup === undefined) {
    throw new Error('Expected selected group.');
  }

  return state.selectedGroup;
}

function createDeleteGroupHandler(groupName: string, mutation: DeleteGroupMutation): () => void {
  return (): void => {
    if (mutation.isPending || window.prompt(readGroupDeleteConfirmationMessage(groupName)) !== groupName) {
      return;
    }

    mutation.mutate();
  };
}

function readGroupEffectivePermissions(state: GroupsPageState): PermissionKey[] {
  const permissionKeys: Set<PermissionKey> = new Set<PermissionKey>();

  for (const assignment of state.groupAssignments) {
    const role: { permissionKeys: PermissionKey[] } | undefined = state.data.roles.find(
      (item: { id: string }): boolean => item.id === assignment.roleId,
    );
    if (role === undefined) {
      continue;
    }
    for (const permissionKey of role.permissionKeys) {
      permissionKeys.add(permissionKey);
    }
  }

  return [...permissionKeys].sort((left: string, right: string): number => left.localeCompare(right));
}
