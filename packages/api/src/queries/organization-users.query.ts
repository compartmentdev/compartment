import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { localCredentials, organizationMemberships, principals } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { findPrincipalCredentialByEmailWithExecutor } from './principal-credentials.query';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';
import {
  buildOrganizationMembershipFilter,
  buildPrincipalHasSsoOidcIdentityExpression,
  buildOrganizationUserSelect,
  toOrganizationUserRow,
} from './organization-users.query.helpers';
import type {
  CreatePrincipalInput,
  OrganizationMembershipAccessRow,
  OrganizationPrincipalAccessRow,
  OrganizationUserQueryRow,
  OrganizationUserRow,
  OrganizationUsersTransaction,
  PrincipalCredentialRow,
  SetBootstrapTokenInput,
} from './organization-users.query.types';

interface ReadOrganizationUserRowsInput {
  email?: string | undefined;
  organizationId: string;
  sortByEmail: boolean;
}

export async function findOrganizationUserByEmail(
  organizationId: string,
  email: string,
): Promise<OrganizationUserRow | undefined> {
  return await findOrganizationUserByEmailWithExecutor(getApiDatabase(), organizationId, email);
}

export async function findOrganizationUserByEmailWithExecutor(
  executor: OrganizationUsersExecutor,
  organizationId: string,
  email: string,
): Promise<OrganizationUserRow | undefined> {
  const rows: OrganizationUserQueryRow[] = await readOrganizationUserRows(executor, {
    email,
    organizationId,
    sortByEmail: false,
  });

  return rows[0] === undefined ? undefined : toOrganizationUserRow(rows[0]);
}

export async function findPrincipalCredentialByEmail(email: string): Promise<PrincipalCredentialRow | undefined> {
  return await findPrincipalCredentialByEmailWithExecutor(getApiDatabase(), email);
}

export async function findOrganizationPrincipalAccessById(
  organizationId: string,
  principalId: string,
): Promise<OrganizationPrincipalAccessRow | undefined> {
  return await findOrganizationPrincipalAccessByIdWithExecutor(getApiDatabase(), organizationId, principalId);
}

export async function findOrganizationMembershipAccessByPrincipalIdWithExecutor(
  executor: OrganizationUsersExecutor,
  organizationId: string,
  principalId: string,
): Promise<OrganizationMembershipAccessRow | undefined> {
  const rows: OrganizationMembershipAccessRow[] = await executor
    .select({
      blockedAt: organizationMemberships.blockedAt,
      principalId: organizationMemberships.principalId,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.principalId, principalId),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function lockPrincipalRowWithExecutor(
  executor: OrganizationUsersTransaction,
  principalId: string,
): Promise<void> {
  await executor.execute(
    sql`select ${principals.id} from ${principals} where ${principals.id} = ${principalId} for update`,
  );
}

export async function createPrincipalWithExecutor(
  executor: OrganizationUsersTransaction,
  input: CreatePrincipalInput,
): Promise<void> {
  await executor.insert(principals).values({
    email: input.email,
    id: input.principalId,
    type: 'user',
  });
}

export async function deletePrincipalWithExecutor(
  executor: OrganizationUsersTransaction,
  principalId: string,
): Promise<void> {
  await executor.delete(principals).where(eq(principals.id, principalId));
}

export async function createPrincipalIfMissingWithExecutor(
  executor: OrganizationUsersTransaction,
  input: CreatePrincipalInput,
): Promise<void> {
  await executor
    .insert(principals)
    .values({
      email: input.email,
      id: input.principalId,
      type: 'user',
    })
    .onConflictDoNothing();
}

export async function createEmptyLocalCredentialsWithExecutor(
  executor: OrganizationUsersTransaction,
  principalId: string,
  updatedAt: Date,
): Promise<void> {
  await executor.insert(localCredentials).values({
    principalId,
    updatedAt,
  });
}

export async function setBootstrapTokenWithExecutor(
  executor: OrganizationUsersTransaction,
  input: SetBootstrapTokenInput,
): Promise<void> {
  await executor
    .update(localCredentials)
    .set({
      bootstrapTokenExpiresAt: input.bootstrapTokenExpiresAt,
      bootstrapTokenHash: input.bootstrapTokenHash,
      updatedAt: input.updatedAt,
    })
    .where(eq(localCredentials.principalId, input.principalId));
}

async function findOrganizationPrincipalAccessByIdWithExecutor(
  executor: OrganizationUsersExecutor,
  organizationId: string,
  principalId: string,
): Promise<OrganizationPrincipalAccessRow | undefined> {
  return (await readOrganizationPrincipalAccessRows(executor, organizationId, principalId))[0];
}

async function readOrganizationPrincipalAccessRows(
  executor: OrganizationUsersExecutor,
  organizationId: string,
  principalId: string,
): Promise<OrganizationPrincipalAccessRow[]> {
  return await executor
    .select({
      blockedAt: organizationMemberships.blockedAt,
      hasSsoOidcIdentity: buildPrincipalHasSsoOidcIdentityExpression(principals.id, organizationId),
      passwordHash: localCredentials.passwordHash,
      principalId: principals.id,
      principalType: principals.type,
    })
    .from(organizationMemberships)
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .leftJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.principalId, principalId),
      ),
    )
    .limit(1);
}

async function readOrganizationUserRows(
  executor: OrganizationUsersExecutor,
  input: ReadOrganizationUserRowsInput,
): Promise<OrganizationUserQueryRow[]> {
  const membershipFilter: SQL | undefined =
    input.email === undefined
      ? buildOrganizationMembershipFilter(input.organizationId)
      : and(buildOrganizationMembershipFilter(input.organizationId), buildPrincipalEmailLookup(input.email));

  if (input.sortByEmail) {
    return await executor
      .select(buildOrganizationUserSelect(input.organizationId))
      .from(organizationMemberships)
      .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
      .leftJoin(localCredentials, eq(localCredentials.principalId, principals.id))
      .where(membershipFilter)
      .orderBy(asc(principals.email));
  }

  return await executor
    .select(buildOrganizationUserSelect(input.organizationId))
    .from(organizationMemberships)
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .leftJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(membershipFilter)
    .limit(1);
}

type OrganizationUsersExecutor = Database | OrganizationUsersTransaction;
