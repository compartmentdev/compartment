import type {
  InviteUserResponse,
  OrganizationUserListRow,
  OrganizationUserResponse,
  OrganizationUserSummary,
  UserInvitation,
  UserListResponse,
} from '@compartment/contracts';
import type {
  InviteOrganizationUserResult,
  OrganizationUserListRowResult,
  OrganizationUserListResult,
  OrganizationUserResult,
  UserInvitationResult,
} from '../../services/organization-users.service.types';

export function buildUserListResponse(result: OrganizationUserListResult): UserListResponse {
  return {
    pagination: result.pagination,
    users: result.users.map(buildOrganizationUserListRow),
  };
}

export function buildOrganizationUserResponse(user: OrganizationUserResult): OrganizationUserResponse {
  return {
    user: buildOrganizationUserSummary(user),
  };
}

export function buildInviteUserResponse(result: InviteOrganizationUserResult): InviteUserResponse {
  return {
    invitation: result.invitation !== null ? buildUserInvitation(result.invitation) : null,
    user: buildOrganizationUserSummary(result.user),
  };
}

function buildOrganizationUserListRow(user: OrganizationUserListRowResult): OrganizationUserListRow {
  return {
    ...buildOrganizationUserSummary(user),
    accessSummary: user.accessSummary,
    directAccessScopeLabels: user.directAccessScopeLabels,
    groupNames: user.groupNames,
  };
}

function buildUserInvitation(invitation: UserInvitationResult): UserInvitation {
  return {
    activationUrl: invitation.activationUrl,
    bootstrapExpiresAt: invitation.bootstrapExpiresAt,
    bootstrapToken: invitation.bootstrapToken,
  };
}

export function buildOrganizationUserSummary(user: OrganizationUserResult): OrganizationUserSummary {
  return {
    access: user.access,
    email: user.email,
    groupCount: user.groupCount,
    id: user.id,
    roleNames: user.roleNames,
    status: user.status,
    type: user.type,
  };
}
