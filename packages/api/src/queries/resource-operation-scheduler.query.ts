import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { environments, organizations, projectResources, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { ScheduledResourceOperationCandidateRow } from './resource-operation-scheduler.query.types';
import { toProjectResourceRow } from './resources.query';
import type { PersistedProjectResourceRow } from './resources.query.types';

interface PersistedScheduledResourceOperationCandidateRow {
  environment: typeof environments.$inferSelect;
  organization: typeof organizations.$inferSelect;
  project: typeof projects.$inferSelect;
  resource: PersistedProjectResourceRow;
}

export async function listScheduledResourceOperationCandidates(): Promise<ScheduledResourceOperationCandidateRow[]> {
  const rows: PersistedScheduledResourceOperationCandidateRow[] = await getApiDatabase()
    .select({
      environment: environments,
      organization: organizations,
      project: projects,
      resource: projectResources,
    })
    .from(projectResources)
    .innerJoin(environments, eq(projectResources.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .where(and(isNull(projects.archivedAt), hasScheduledBackupOperation()))
    .orderBy(asc(projectResources.createdAt));

  return rows.map(toScheduledResourceOperationCandidateRow);
}

function hasScheduledBackupOperation(): SQL<boolean> {
  return sql<boolean>`jsonb_typeof(${projectResources.operationsJson}::jsonb #> '{backup,schedule}') = 'object'`;
}

function toScheduledResourceOperationCandidateRow(
  row: PersistedScheduledResourceOperationCandidateRow,
): ScheduledResourceOperationCandidateRow {
  return {
    environment: row.environment,
    organization: {
      id: row.organization.id,
      name: row.organization.name,
      slug: row.organization.slug,
    },
    project: row.project,
    resource: toProjectResourceRow(row.resource),
  };
}
