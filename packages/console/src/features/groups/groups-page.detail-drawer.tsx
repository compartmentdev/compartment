import { type AccessGroupListRow, type PermissionKey } from '@compartment/contracts/browser';
import { type JSX, useEffect, useState } from 'react';
import { AccessAdditionalCard } from '../access/access-additional-card';
import { AccessDrawerCollapsibleSection } from '../access/access-drawer-collapsible-section';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerSection } from '../access/access-ui';
import { PermissionFamiliesCard } from '../access/access-permission-families';
import { canManageBrowserGroups, canManageBrowserRoles, canReadBrowserRoles } from '../console/console-access';
import { ManageRolesButton } from '../roles/manage-roles-button';
import { GroupAssignmentsCard } from './groups-page.assignments';
import { GroupDeleteAction } from './groups-page.delete-action';
import { GroupSummaryCard } from './groups-page.detail-layout';
import { GroupMembersCard } from './groups-page.members';
import type { GroupsPageState } from './groups-page.state';

interface GroupDetailDrawerProps {
  state: GroupsPageState;
}

export function useGroupDetailEditingState(
  selectedGroupId: string | undefined,
): Readonly<{ isEditing: boolean; setIsEditing: (value: boolean) => void }> {
  const [isEditing, setIsEditing] = useState<boolean>(false);

  useEffect((): void => {
    setIsEditing(false);
  }, [selectedGroupId]);

  return { isEditing, setIsEditing };
}

export function GroupDetailDrawerContent({
  isEditing,
  setIsEditing,
  state,
}: Readonly<{
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  state: GroupsPageState;
}>): JSX.Element | null {
  if (state.selectedGroup === undefined) {
    return null;
  }

  const effectivePermissions: PermissionKey[] = readGroupEffectivePermissions(state);

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

  const selectedGroup: AccessGroupListRow = requireSelectedGroup(state);

  return (
    <AccessDrawerSection title="Additional">
      <AccessAdditionalCard
        action={<GroupDeleteAction selectedGroup={selectedGroup} state={state} />}
        description="Delete group and reset permissions for people in the group."
        title="Danger zone"
        tone="danger"
      />
    </AccessDrawerSection>
  );
}

function requireSelectedGroup(state: GroupsPageState): AccessGroupListRow {
  if (state.selectedGroup === undefined) {
    throw new Error('Expected selected group.');
  }

  return state.selectedGroup;
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
