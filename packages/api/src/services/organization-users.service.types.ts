import type {
  AccessSummaryLabel,
  ListSortDirection,
  OrganizationUserAccess,
  OrganizationUserType,
  UserListOrderBy,
} from '@compartment/contracts';
import type { ListPagination } from './list-pagination.service.helpers';

export type OrganizationUserAccountStatus = 'active' | 'invited';
export type OrganizationUserOrganizationAccess = OrganizationUserAccess;

export interface OrganizationUserResult {
  access: OrganizationUserOrganizationAccess;
  email: string;
  groupCount: number;
  id: string;
  roleNames: string[];
  status: OrganizationUserAccountStatus;
  type: OrganizationUserType;
}

export interface OrganizationUserListRowResult extends OrganizationUserResult {
  accessSummary: AccessSummaryLabel;
  directAccessScopeLabels: string[];
  groupNames: string[];
}

export interface UserInvitationResult {
  activationUrl: string;
  bootstrapExpiresAt: string;
  bootstrapToken: string;
}

export interface InviteOrganizationUserInput {
  actorPrincipalId: string;
  email: string;
  organizationId: string;
  organizationSlug: string;
}

export interface InviteOrganizationUserResult {
  invitation: UserInvitationResult | null;
  user: OrganizationUserResult;
}

export interface ListOrganizationUsersInput {
  organizationId: string;
  orderBy?: UserListOrderBy | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

export interface OrganizationUserListResult {
  pagination: ListPagination;
  users: OrganizationUserListRowResult[];
}

export interface RemoveOrganizationUserInput {
  actorPrincipalId: string;
  email: string;
  organizationId: string;
  organizationSlug: string;
}

export interface OrganizationUserRemovalPersistenceResult {
  revokedSessionIds: string[];
  user: OrganizationUserResult;
}

export interface UpdateOrganizationUserAccessInput {
  actorPrincipalId: string;
  blocked: boolean;
  email: string;
  organizationId: string;
  organizationSlug: string;
}

export type OrganizationUserAccessMutationInput = Omit<UpdateOrganizationUserAccessInput, 'blocked'>;
