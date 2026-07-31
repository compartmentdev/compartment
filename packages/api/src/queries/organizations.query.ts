import { and, count, eq, isNull } from 'drizzle-orm';
import { organizationMemberships, organizations, principals } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  findOrganizationRowForPrincipalByIdWithExecutor as findMembershipOrganizationRowForPrincipalByIdWithExecutor,
  findOrganizationRowForPrincipalBySlugWithExecutor as findMembershipOrganizationRowForPrincipalBySlugWithExecutor,
  listOrganizationRowsForPrincipalWithExecutor as listMembershipOrganizationRowsForPrincipalWithExecutor,
} from './organization-memberships.query';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';
import type {
  CreateOrganizationInput,
  OrganizationCreationTransaction,
  OrganizationQueryExecutor,
  OrganizationRow,
} from './organizations.query.types';

const organizationRowSelection: {
  id: typeof organizations.id;
  name: typeof organizations.name;
  slug: typeof organizations.slug;
} = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
};

export async function listOrganizationRowsForPrincipal(principalId: string): Promise<OrganizationRow[]> {
  return await listOrganizationRowsForPrincipalWithExecutor(getApiDatabase(), principalId);
}

export async function listOrganizationRowsForPrincipalWithExecutor(
  executor: OrganizationQueryExecutor,
  principalId: string,
): Promise<OrganizationRow[]> {
  return await listMembershipOrganizationRowsForPrincipalWithExecutor(executor, principalId);
}

export async function listOrganizationRows(): Promise<OrganizationRow[]> {
  return await getApiDatabase().select(organizationRowSelection).from(organizations);
}

export async function countOrganizations(): Promise<number> {
  const rows: { count: number }[] = await getApiDatabase()
    .select({
      count: count(),
    })
    .from(organizations);

  return rows[0]?.count ?? 0;
}

export async function findOrganizationById(organizationId: string): Promise<OrganizationRow | undefined> {
  const rows: OrganizationRow[] = await getApiDatabase()
    .select(organizationRowSelection)
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  return rows[0];
}

export async function findOrganizationBySlug(organizationSlug: string): Promise<OrganizationRow | undefined> {
  const rows: OrganizationRow[] = await getApiDatabase()
    .select(organizationRowSelection)
    .from(organizations)
    .where(eq(organizations.slug, organizationSlug))
    .limit(1);

  return rows[0];
}

export async function findOrganizationRowForPrincipalBySlug(
  principalId: string,
  organizationSlug: string,
): Promise<OrganizationRow | undefined> {
  return await findMembershipOrganizationRowForPrincipalBySlugWithExecutor(
    getApiDatabase(),
    principalId,
    organizationSlug,
  );
}

export async function findOrganizationRowForPrincipalByIdWithExecutor(
  executor: OrganizationQueryExecutor,
  principalId: string,
  organizationId: string,
): Promise<OrganizationRow | undefined> {
  return await findMembershipOrganizationRowForPrincipalByIdWithExecutor(executor, principalId, organizationId);
}

export async function listOrganizationRowsForPrincipalEmail(email: string): Promise<OrganizationRow[]> {
  return await getApiDatabase()
    .select(organizationRowSelection)
    .from(organizationMemberships)
    .innerJoin(principals, eq(organizationMemberships.principalId, principals.id))
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(and(buildPrincipalEmailLookup(email), isNull(organizationMemberships.blockedAt)));
}

export async function createOrganizationWithExecutor(
  executor: OrganizationCreationTransaction,
  input: CreateOrganizationInput,
): Promise<OrganizationRow> {
  const rows: OrganizationRow[] = await executor
    .insert(organizations)
    .values({
      id: input.id,
      name: input.name,
      slug: input.slug,
    })
    .returning(organizationRowSelection);

  const organization: OrganizationRow | undefined = rows[0];
  if (organization === undefined) {
    throw new Error('Expected organization creation to return a row.');
  }

  return organization;
}
