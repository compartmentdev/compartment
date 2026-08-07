import { createUserNotManageableError } from '../errors/api-business-error';
import type { InsertOperationInput } from '../queries/operations.query.types';
import type { ListOrganizationUsersPageInput } from '../queries/organization-users-list.query.types';
import { findOrganizationUserByEmail } from '../queries/organization-users.query';
import type { OrganizationUserRow, PrincipalCredentialRow } from '../queries/organization-users.query.types';
import { listPrincipalGrantedRoleNames } from '../queries/rbac-assignments.query';
import { listPrincipalGroupCounts } from '../queries/rbac-groups.query';
import type { PrincipalGrantedRoleNameRow, PrincipalGroupCountRow } from '../queries/rbac.query.types';
import type {
  InviteOrganizationUserInput,
  InviteOrganizationUserResult,
  ListOrganizationUsersInput,
  OrganizationUserAccountStatus,
  OrganizationUserOrganizationAccess,
  OrganizationUserResult,
  RemoveOrganizationUserInput,
  UpdateOrganizationUserAccessInput,
  UserInvitationResult,
} from './organization-users.service.types';

export { hydrateOrganizationUserListRows } from './organization-users.service.list-rows';

export interface InvitationPlan {
  activationUrl: string;
  expiresAt: Date;
  token: string;
  tokenHash: string;
}

export interface InvitationContext {
  existingPrincipal: PrincipalCredentialRow | undefined;
  invitation: InvitationPlan | null;
  principalId: string;
}

export function buildInviteUserResult(
  user: OrganizationUserResult,
  invitation: InvitationPlan | null,
): InviteOrganizationUserResult {
  return {
    invitation: invitation !== null ? toInvitationResult(invitation) : null,
    user,
  };
}

export function buildInviteOperation(input: InviteOrganizationUserInput, principalId: string): InsertOperationInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    completedAt: new Date(),
    organizationId: input.organizationId,
    status: 'succeeded',
    summary: `Invited ${input.email} to ${input.organizationSlug}`,
    targetId: principalId,
    targetType: 'principal',
    type: 'organization.user.invite',
  };
}

export function buildOrganizationUsersListInput(input: ListOrganizationUsersInput): ListOrganizationUsersPageInput {
  return {
    orderBy: input.orderBy ?? 'email',
    organizationId: input.organizationId,
    page: input.page ?? 1,
    perPage: input.perPage ?? 100,
    search: input.search,
    sort: input.sort ?? 'asc',
    type: input.type,
  };
}

export function buildRemoveOperation(input: RemoveOrganizationUserInput, principalId: string): InsertOperationInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    completedAt: new Date(),
    organizationId: input.organizationId,
    status: 'succeeded',
    summary: `Removed ${input.email} from ${input.organizationSlug}`,
    targetId: principalId,
    targetType: 'principal',
    type: 'organization.user.remove',
  };
}

export function buildBlockOperation(
  input: UpdateOrganizationUserAccessInput,
  principalId: string,
): InsertOperationInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    completedAt: new Date(),
    organizationId: input.organizationId,
    status: 'succeeded',
    summary: `Blocked ${input.email} from ${input.organizationSlug}`,
    targetId: principalId,
    targetType: 'principal',
    type: 'organization.user.block',
  };
}

export function buildUnblockOperation(
  input: UpdateOrganizationUserAccessInput,
  principalId: string,
): InsertOperationInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    completedAt: new Date(),
    organizationId: input.organizationId,
    status: 'succeeded',
    summary: `Unblocked ${input.email} in ${input.organizationSlug}`,
    targetId: principalId,
    targetType: 'principal',
    type: 'organization.user.unblock',
  };
}

export function shouldCreateLocalCredentials(existingPrincipal: PrincipalCredentialRow | undefined): boolean {
  return existingPrincipal?.credentialPrincipalId == null;
}

export async function hydrateOrganizationUserResult(
  organizationId: string,
  user: OrganizationUserResult,
): Promise<OrganizationUserResult> {
  const [hydratedUser]: OrganizationUserResult[] = await hydrateOrganizationUserResults(organizationId, [user]);
  if (hydratedUser === undefined) {
    throw new Error('Expected hydrated organization user.');
  }

  return hydratedUser;
}

export async function hydrateOrganizationUserResults(
  organizationId: string,
  users: readonly OrganizationUserResult[],
): Promise<OrganizationUserResult[]> {
  if (users.length === 0) {
    return [];
  }

  const principalIds: string[] = [...new Set(users.map((user: OrganizationUserResult): string => user.id))];
  const [groupCounts, roleNames]: [PrincipalGroupCountRow[], PrincipalGrantedRoleNameRow[]] = await Promise.all([
    listPrincipalGroupCounts(organizationId, principalIds),
    listPrincipalGrantedRoleNames(organizationId, principalIds),
  ]);
  const groupCountByPrincipalId: ReadonlyMap<string, number> = new Map<string, number>(
    groupCounts.map((row: PrincipalGroupCountRow): [string, number] => [row.principalId, row.groupCount]),
  );
  const roleNamesByPrincipalId: ReadonlyMap<string, string[]> = buildRoleNamesByPrincipalId(roleNames);

  return users.map(
    (user: OrganizationUserResult): OrganizationUserResult => ({
      ...user,
      groupCount: groupCountByPrincipalId.get(user.id) ?? 0,
      roleNames: roleNamesByPrincipalId.get(user.id) ?? [],
    }),
  );
}

export async function readExistingOrganizationUser(
  organizationId: string,
  email: string,
): Promise<OrganizationUserResult | undefined> {
  const user: OrganizationUserRow | undefined = await findOrganizationUserByEmail(organizationId, email);

  return user === undefined ? undefined : toOrganizationUserResult(user);
}

export function requireInvitablePrincipal(
  existingPrincipal: PrincipalCredentialRow | undefined,
): PrincipalCredentialRow | undefined {
  if (existingPrincipal?.principalType === 'automation') {
    throw createUserNotManageableError();
  }

  return existingPrincipal;
}

export function toOrganizationUserResult(user: OrganizationUserRow): OrganizationUserResult {
  return {
    access: readOrganizationUserAccess(user),
    email: user.email,
    groupCount: user.groupCount,
    id: user.id,
    roleNames: user.roleNames,
    status: readOrganizationUserStatus(user),
    type: user.type,
  };
}

function readOrganizationUserAccess(user: OrganizationUserRow): OrganizationUserOrganizationAccess {
  return user.blockedAt === null ? 'allowed' : 'blocked';
}

function readOrganizationUserStatus(user: OrganizationUserRow): OrganizationUserAccountStatus {
  return user.type === 'automation' || user.passwordHash !== null || user.hasSsoOidcIdentity ? 'active' : 'invited';
}

function buildRoleNamesByPrincipalId(rows: readonly PrincipalGrantedRoleNameRow[]): ReadonlyMap<string, string[]> {
  const roleNamesByPrincipalId: Map<string, string[]> = new Map<string, string[]>();
  for (const row of rows) {
    const principalRoleNames: string[] = roleNamesByPrincipalId.get(row.principalId) ?? [];
    principalRoleNames.push(row.roleName);
    roleNamesByPrincipalId.set(row.principalId, principalRoleNames);
  }

  return roleNamesByPrincipalId;
}

function toInvitationResult(plan: InvitationPlan): UserInvitationResult {
  return {
    activationUrl: plan.activationUrl,
    bootstrapExpiresAt: plan.expiresAt.toISOString(),
    bootstrapToken: plan.token,
  };
}
