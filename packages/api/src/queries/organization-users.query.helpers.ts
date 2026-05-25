import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import {
  localCredentials,
  organizationMemberships,
  principals,
  ssoOidcIdentities,
  ssoOidcProviders,
} from '../db/schema';
import type {
  OrganizationPrincipalType,
  OrganizationUserQueryRow,
  OrganizationUserRow,
} from './organization-users.query.types';

interface OrganizationUserSelection extends SelectedFields {
  blockedAt: typeof organizationMemberships.blockedAt;
  bootstrapTokenExpiresAt: typeof localCredentials.bootstrapTokenExpiresAt;
  email: typeof principals.email;
  hasSsoOidcIdentity: SQL<boolean>;
  id: typeof principals.id;
  passwordHash: typeof localCredentials.passwordHash;
  type: typeof principals.type;
}

export function buildActiveOrganizationMembershipFilter(organizationId: string): SQL | undefined {
  return and(buildOrganizationMembershipFilter(organizationId), isNull(organizationMemberships.blockedAt));
}

export function buildOrganizationMembershipFilter(organizationId: string): SQL | undefined {
  return eq(organizationMemberships.organizationId, organizationId);
}

export function buildOrganizationUserSelect(organizationId: string): OrganizationUserSelection {
  return {
    blockedAt: organizationMemberships.blockedAt,
    bootstrapTokenExpiresAt: localCredentials.bootstrapTokenExpiresAt,
    email: principals.email,
    hasSsoOidcIdentity: buildPrincipalHasSsoOidcIdentityExpression(principals.id, organizationId),
    id: principals.id,
    passwordHash: localCredentials.passwordHash,
    type: principals.type,
  };
}

export function buildOrganizationUserStatusText(organizationId: string): SQL<string> {
  return sql<string>`case
    when ${buildOrganizationUserIsActiveExpression(organizationId)} then 'active'
    else 'invited'
  end`;
}

export function buildOrganizationUserTypeSearchText(): SQL<string> {
  return sql<string>`case
    when ${principals.type} = 'automation' then 'automation system'
    else 'user'
  end`;
}

export function buildOrganizationUserAccessText(): SQL<string> {
  return sql<string>`case
    when ${organizationMemberships.blockedAt} is null then 'allowed'
    else 'blocked'
  end`;
}

export function toOrganizationUserRow(row: OrganizationUserQueryRow): OrganizationUserRow {
  return {
    blockedAt: row.blockedAt,
    bootstrapTokenExpiresAt: row.bootstrapTokenExpiresAt,
    email: row.email,
    groupCount: 0,
    hasSsoOidcIdentity: row.hasSsoOidcIdentity,
    id: row.id,
    passwordHash: row.passwordHash,
    roleNames: [],
    type: row.type as OrganizationPrincipalType,
  };
}

export function buildOrganizationUserIsActiveExpression(organizationId: string): SQL<boolean> {
  return sql<boolean>`${principals.type} = 'automation' or ${localCredentials.passwordHash} is not null or ${buildPrincipalHasSsoOidcIdentityExpression(
    principals.id,
    organizationId,
  )}`;
}

export function buildPrincipalHasSsoOidcIdentityExpression(
  principalId: typeof principals.id,
  organizationId: string,
): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
    from ${ssoOidcIdentities}
    inner join ${ssoOidcProviders} on ${ssoOidcProviders.id} = ${ssoOidcIdentities.providerId}
    where ${ssoOidcIdentities.principalId} = ${principalId}
      and ${ssoOidcProviders.organizationId} = ${organizationId}
  )`;
}
