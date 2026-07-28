import type { CustomDomainCheckStatus, CustomDomainState } from '@compartment/contracts';
import { and, asc, eq, exists, ne, type QueryPromise, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import { deploymentCustomDomains, environments, organizations, projectServices, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  CustomDomainRow,
  InsertCustomDomainInput,
  ListCustomDomainsInput,
  UpdateCustomDomainCheckInput,
} from './custom-domains.query.types';

interface PersistedCustomDomainRow extends Omit<
  CustomDomainRow,
  'ownershipStatus' | 'reconcileState' | 'routingStatus'
> {
  ownershipStatus: string;
  reconcileState: string;
  routingStatus: string;
}

type CustomDomainLookupFilteredQuery = QueryPromise<PersistedCustomDomainRow[]> & {
  limit(limit: number): QueryPromise<PersistedCustomDomainRow[]>;
  orderBy(...columns: SQL[]): QueryPromise<PersistedCustomDomainRow[]>;
};

type CustomDomainLookupQuery = QueryPromise<PersistedCustomDomainRow[]> & {
  where(where: SQL | undefined): CustomDomainLookupFilteredQuery;
};

interface CustomDomainSelection extends SelectedFields {
  createdAt: typeof deploymentCustomDomains.createdAt;
  desiredGeneration: typeof deploymentCustomDomains.desiredGeneration;
  edgeRoutingEnabled: typeof deploymentCustomDomains.edgeRoutingEnabled;
  environmentId: typeof environments.id;
  environmentName: typeof environments.name;
  failureMessage: typeof deploymentCustomDomains.failureMessage;
  host: typeof deploymentCustomDomains.host;
  id: typeof deploymentCustomDomains.id;
  lastCheckedAt: typeof deploymentCustomDomains.lastCheckedAt;
  organizationId: typeof organizations.id;
  ownershipStatus: typeof deploymentCustomDomains.ownershipStatus;
  observedCertificatePresent: typeof deploymentCustomDomains.observedCertificatePresent;
  observedCertificateReady: typeof deploymentCustomDomains.observedCertificateReady;
  observedGeneration: typeof deploymentCustomDomains.observedGeneration;
  observedIngressPresent: typeof deploymentCustomDomains.observedIngressPresent;
  projectId: typeof projects.id;
  projectName: typeof projects.name;
  routingStatus: typeof deploymentCustomDomains.routingStatus;
  reconcileLeaseExpiresAt: typeof deploymentCustomDomains.reconcileLeaseExpiresAt;
  reconcileLeaseId: typeof deploymentCustomDomains.reconcileLeaseId;
  reconcileState: typeof deploymentCustomDomains.reconcileState;
  serviceId: typeof projectServices.id;
  serviceName: typeof projectServices.name;
  updatedAt: typeof deploymentCustomDomains.updatedAt;
  verificationTokenHash: typeof deploymentCustomDomains.verificationTokenHash;
  verifiedAt: typeof deploymentCustomDomains.verifiedAt;
}

const customDomainSelection: CustomDomainSelection = {
  createdAt: deploymentCustomDomains.createdAt,
  desiredGeneration: deploymentCustomDomains.desiredGeneration,
  edgeRoutingEnabled: deploymentCustomDomains.edgeRoutingEnabled,
  environmentId: environments.id,
  environmentName: environments.name,
  failureMessage: deploymentCustomDomains.failureMessage,
  host: deploymentCustomDomains.host,
  id: deploymentCustomDomains.id,
  lastCheckedAt: deploymentCustomDomains.lastCheckedAt,
  organizationId: organizations.id,
  ownershipStatus: deploymentCustomDomains.ownershipStatus,
  observedCertificatePresent: deploymentCustomDomains.observedCertificatePresent,
  observedCertificateReady: deploymentCustomDomains.observedCertificateReady,
  observedGeneration: deploymentCustomDomains.observedGeneration,
  observedIngressPresent: deploymentCustomDomains.observedIngressPresent,
  projectId: projects.id,
  projectName: projects.name,
  routingStatus: deploymentCustomDomains.routingStatus,
  reconcileLeaseExpiresAt: deploymentCustomDomains.reconcileLeaseExpiresAt,
  reconcileLeaseId: deploymentCustomDomains.reconcileLeaseId,
  reconcileState: deploymentCustomDomains.reconcileState,
  serviceId: projectServices.id,
  serviceName: projectServices.name,
  updatedAt: deploymentCustomDomains.updatedAt,
  verificationTokenHash: deploymentCustomDomains.verificationTokenHash,
  verifiedAt: deploymentCustomDomains.verifiedAt,
};

export async function insertCustomDomain(input: InsertCustomDomainInput): Promise<void> {
  await getApiDatabase().insert(deploymentCustomDomains).values({
    createdByPrincipalId: input.createdByPrincipalId,
    environmentId: input.environmentId,
    host: input.host,
    id: input.id,
    ownershipStatus: 'pending',
    projectServiceId: input.projectServiceId,
    routingStatus: 'pending',
    updatedAt: input.updatedAt,
    verificationTokenHash: input.verificationTokenHash,
  });
}

export async function findCustomDomainForOrganization(
  organizationId: string,
  host: string,
): Promise<CustomDomainRow | undefined> {
  const rows: PersistedCustomDomainRow[] = await createCustomDomainLookupQuery()
    .where(and(eq(organizations.id, organizationId), eq(deploymentCustomDomains.host, host)))
    .limit(1);

  return rows[0] === undefined ? undefined : toCustomDomainRow(rows[0]);
}

export async function findCustomDomainByHost(host: string): Promise<CustomDomainRow | undefined> {
  const rows: PersistedCustomDomainRow[] = await createCustomDomainLookupQuery()
    .where(eq(deploymentCustomDomains.host, host))
    .limit(1);
  return rows[0] === undefined ? undefined : toCustomDomainRow(rows[0]);
}

export async function listCustomDomains(input: ListCustomDomainsInput): Promise<CustomDomainRow[]> {
  const rows: PersistedCustomDomainRow[] = await createCustomDomainLookupQuery()
    .where(buildCustomDomainListPredicate(input))
    .orderBy(asc(projects.name), asc(environments.name), asc(projectServices.name), asc(deploymentCustomDomains.host));

  return rows.map(toCustomDomainRow);
}

export async function updateCustomDomainCheck(input: UpdateCustomDomainCheckInput): Promise<void> {
  await getApiDatabase()
    .update(deploymentCustomDomains)
    .set({
      failureMessage: input.failureMessage,
      lastCheckedAt: input.lastCheckedAt,
      ownershipStatus: input.ownershipStatus,
      desiredGeneration: input.desiredGeneration,
      edgeRoutingEnabled: false,
      observedCertificatePresent: false,
      observedCertificateReady: false,
      observedGeneration: 0,
      observedIngressPresent: false,
      reconcileLeaseExpiresAt: null,
      reconcileLeaseId: null,
      reconcileState: input.reconcileState,
      routingStatus: input.routingStatus,
      updatedAt: input.updatedAt,
      verifiedAt: input.verifiedAt,
    })
    .where(buildMutableCustomDomainPredicate(input));
}

function buildMutableCustomDomainPredicate(input: UpdateCustomDomainCheckInput): SQL {
  return and(
    eq(deploymentCustomDomains.id, input.id),
    eq(deploymentCustomDomains.host, input.host),
    eq(deploymentCustomDomains.desiredGeneration, input.desiredGeneration - 1),
    ne(deploymentCustomDomains.reconcileState, 'deleting'),
    buildCustomDomainOrganizationPredicate(input.organizationId),
  )!;
}

function buildCustomDomainOrganizationPredicate(organizationId: string): SQL {
  return exists(
    getApiDatabase()
      .select({ id: environments.id })
      .from(environments)
      .innerJoin(projects, eq(environments.projectId, projects.id))
      .where(
        and(eq(environments.id, deploymentCustomDomains.environmentId), eq(projects.organizationId, organizationId)),
      ),
  );
}

function createCustomDomainLookupQuery(): CustomDomainLookupQuery {
  return getApiDatabase()
    .select(customDomainSelection)
    .from(deploymentCustomDomains)
    .innerJoin(environments, eq(deploymentCustomDomains.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .innerJoin(projectServices, eq(deploymentCustomDomains.projectServiceId, projectServices.id));
}

function buildCustomDomainListPredicate(input: ListCustomDomainsInput): SQL {
  const predicates: SQL[] = [eq(organizations.id, input.organizationId)];
  if (input.projectName !== undefined) {
    predicates.push(eq(projects.name, input.projectName));
  }
  if (input.environmentName !== undefined) {
    predicates.push(eq(environments.name, input.environmentName));
  }
  if (input.serviceName !== undefined) {
    predicates.push(eq(projectServices.name, input.serviceName));
  }

  return and(...predicates)!;
}

function toCustomDomainRow(row: PersistedCustomDomainRow): CustomDomainRow {
  return {
    ...row,
    ownershipStatus: row.ownershipStatus as CustomDomainCheckStatus,
    reconcileState: row.reconcileState as CustomDomainState,
    routingStatus: row.routingStatus as CustomDomainCheckStatus,
  };
}
