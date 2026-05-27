import type { PermissionKey, UserAccessDetail } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { IconTile } from '../../components/ui/icon-tile';
import { UserRound } from '../../components/ui/icons';
import { StatusTag } from '../../components/ui/status-tag';
import { AccessDrawerCollapsibleSection } from '../access/access-drawer-collapsible-section';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import {
  accessDrawerSummaryIdentityClassName,
  accessDrawerSummaryTitleClassName,
  AccessDrawerSection,
  AccessDrawerShell,
} from '../access/access-ui';
import { PermissionFamiliesCard } from '../access/access-permission-families';
import { canManageBrowserGroups, canManageBrowserRoles, canReadBrowserRoles } from '../console/console-access';
import { ManageRolesButton } from '../roles/manage-roles-button';
import { UserAdditionalSection } from './user-access-panel.additional';
import { UserDirectAssignmentsCard } from './user-access-panel.assignments';
import { UserGroupMembershipsCard } from './user-access-panel.groups';
import { readUserStatusTagPresentation, type UserStatusTagPresentation } from './user-status-labels';
import {
  copyUserInvitationLink,
  openUserInvitationLink,
  type ActivationLinkUserInvitationState,
  type VisibleUserInvitationState,
  UserInvitationPanel,
} from './user-invitation';
import type { UserAccessPanelState } from './user-access-panel.state';
import { buildUsersHref } from './users-query';

interface UserDetailDrawerProps {
  access: UserAccessDetail;
  state: UserAccessPanelState;
}

export function UserDetailDrawer({ access, state }: Readonly<UserDetailDrawerProps>): JSX.Element {
  return (
    <AccessDrawerShell
      closeHref={buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null })}
      header={
        <AccessDrawerDetailHeader
          closeHref={buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null })}
          eyebrow="User"
          onNavigate={state.onNavigate}
        />
      }
      onNavigate={state.onNavigate}
      title={access.user.email}
    >
      <UserDetailContent access={access} state={state} />
    </AccessDrawerShell>
  );
}

function UserDetailContent({ access, state }: Readonly<UserDetailDrawerProps>): JSX.Element {
  return (
    <>
      <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
      <UserSummaryCard access={access} />
      <UserInvitationSection access={access} state={state} />
      <UserGroupMembershipSection access={access} state={state} />
      <UserDirectAssignmentsSection access={access} state={state} />
      <UserPermissionsCard permissionKeys={access.effectivePermissions} />
      <UserAdditionalSection access={access} state={state} />
    </>
  );
}

function UserInvitationSection({ access, state }: Readonly<UserDetailDrawerProps>): JSX.Element | null {
  const invitationState: VisibleUserInvitationState | null = readVisibleUserInvitationState(access, state);
  if (invitationState === null) {
    return null;
  }

  return (
    <AccessDrawerSection description={readInvitationSectionDescription(invitationState)} title="Invitation">
      <UserInvitationPanel
        onCopy={readInvitationCopyHandler(invitationState, state)}
        onDismiss={readInvitationDismissHandler(state)}
        onOpen={readInvitationOpenHandler(invitationState)}
        state={invitationState}
      />
    </AccessDrawerSection>
  );
}

function UserGroupMembershipSection({ access, state }: Readonly<UserDetailDrawerProps>): JSX.Element {
  return (
    <UserGroupMembershipsCard
      access={access}
      availableGroups={state.availableGroups}
      canManageGroups={canManageBrowserGroups(state.data.currentOrganizationPermissions)}
      data={state.data}
      groupId={state.groupId}
      setData={state.setData}
      setErrorMessage={state.setDrawerErrorMessage}
      setGroupId={state.setGroupId}
    />
  );
}

function UserDirectAssignmentsSection({ access, state }: Readonly<UserDetailDrawerProps>): JSX.Element {
  const canReadRoles: boolean = canReadBrowserRoles(state.data.currentOrganizationPermissions);

  return (
    <UserDirectAssignmentsCard
      access={access}
      actions={readUserDirectAssignmentActions(canReadRoles, state)}
      canManageRoles={canManageBrowserRoles(state.data.currentOrganizationPermissions)}
      data={state.data}
      environmentValues={state.environmentValues}
      projectNames={state.projectNames}
      roleId={state.roleId}
      scopeType={state.scopeType}
      setData={state.setData}
      setErrorMessage={state.setDrawerErrorMessage}
      setEnvironmentValues={state.setEnvironmentValues}
      setProjectNames={state.setProjectNames}
      setRoleId={state.setRoleId}
      setScopeType={state.setScopeType}
    />
  );
}

function readUserDirectAssignmentActions(canReadRoles: boolean, state: UserAccessPanelState): JSX.Element | undefined {
  return canReadRoles ? (
    <ManageRolesButton onNavigate={state.onNavigate} organizationSlug={state.data.selectedOrganizationSlug} />
  ) : undefined;
}

function UserSummaryCard({ access }: Readonly<{ access: UserAccessDetail }>): JSX.Element {
  return (
    <AccessDrawerSection separated={false}>
      <UserSummaryHeader access={access} />
    </AccessDrawerSection>
  );
}

function UserSummaryHeader({ access }: Readonly<{ access: UserAccessDetail }>): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className={accessDrawerSummaryIdentityClassName}>
        <IconTile className="rounded-full" icon={UserRound} />
        <p className={accessDrawerSummaryTitleClassName}>{access.user.email}</p>
      </div>
      <UserStatusBadge access={access} />
    </div>
  );
}

function UserStatusBadge({ access }: Readonly<{ access: UserAccessDetail }>): JSX.Element {
  const presentation: UserStatusTagPresentation = readUserStatusTagPresentation(access.user);

  return (
    <StatusTag
      className="shrink-0"
      icon={presentation.icon}
      label={presentation.label}
      variant={presentation.variant}
    />
  );
}

function UserPermissionsCard({ permissionKeys }: Readonly<{ permissionKeys: PermissionKey[] }>): JSX.Element {
  return (
    <AccessDrawerCollapsibleSection
      defaultExpanded={true}
      description="Resulting access from groups + direct assignments"
      summary={`${permissionKeys.length} effective permissions in total`}
      title="Effective permissions"
    >
      <PermissionFamiliesCard permissionKeys={permissionKeys} />
    </AccessDrawerCollapsibleSection>
  );
}

function readVisibleUserInvitationState(
  access: UserAccessDetail,
  state: UserAccessPanelState,
): VisibleUserInvitationState | null {
  const invitationState: VisibleUserInvitationState | null = state.userInvitationState;
  const selectedOrganizationSlug: string | null = state.data.selectedOrganizationSlug;
  if (access.user.status !== 'invited') {
    return null;
  }
  if (invitationState === null || selectedOrganizationSlug === null) {
    return null;
  }
  if (invitationState.organizationSlug !== selectedOrganizationSlug) {
    return null;
  }

  return invitationState.email === access.user.email ? invitationState : null;
}

function readInvitationSectionDescription(invitationState: VisibleUserInvitationState): string {
  return invitationState.kind === 'activation_link'
    ? 'Use this activation link while the invitation is still active.'
    : 'This invited user must sign in with SSO to finish access.';
}

function readInvitationCopyHandler(
  invitationState: VisibleUserInvitationState,
  state: UserAccessPanelState,
): (() => void) | undefined {
  const activationInvitationState: ActivationLinkUserInvitationState | null =
    invitationState.kind === 'activation_link' ? invitationState : null;
  if (activationInvitationState === null) {
    return undefined;
  }

  return (): void => {
    void copyUserInvitationLink(activationInvitationState, state.setUserInvitationState);
  };
}

function readInvitationOpenHandler(invitationState: VisibleUserInvitationState): (() => void) | undefined {
  const activationInvitationState: ActivationLinkUserInvitationState | null =
    invitationState.kind === 'activation_link' ? invitationState : null;
  if (activationInvitationState === null) {
    return undefined;
  }

  return (): void => {
    openUserInvitationLink(activationInvitationState);
  };
}

function readInvitationDismissHandler(state: UserAccessPanelState): () => void {
  return (): void => {
    state.setUserInvitationState(null);
  };
}
