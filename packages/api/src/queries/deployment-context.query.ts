import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { environments, projectServices } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  CreateEnvironmentInput,
  CreateProjectServiceInput,
  EnvironmentRow,
  PersistedEnvironmentRow,
  PersistedProjectServiceRow,
  ProjectServiceCountRow,
  ProjectServiceRow,
  UpdateProjectServiceInput,
} from './deployments.query.types';
import { toProjectServiceRow } from './project-service-row.mapper';

export async function createOrGetProjectService(input: CreateProjectServiceInput): Promise<ProjectServiceRow> {
  const [service]: PersistedProjectServiceRow[] = await getApiDatabase()
    .insert(projectServices)
    .values(input)
    .onConflictDoNothing({
      target: [projectServices.projectId, projectServices.name],
    })
    .returning();

  if (service !== undefined) {
    return toProjectServiceRow(service);
  }

  return requirePersistedRow(await findProjectServiceByName(input.projectId, input.name), 'project service');
}

export async function findProjectServiceByName(
  projectId: string,
  serviceName: string,
): Promise<ProjectServiceRow | undefined> {
  const rows: PersistedProjectServiceRow[] = await getApiDatabase()
    .select()
    .from(projectServices)
    .where(and(eq(projectServices.projectId, projectId), eq(projectServices.name, serviceName)))
    .limit(1);

  return rows[0] !== undefined ? toProjectServiceRow(rows[0]) : undefined;
}

export async function listProjectServicesByProjectId(projectId: string): Promise<ProjectServiceRow[]> {
  const rows: PersistedProjectServiceRow[] = await getApiDatabase()
    .select()
    .from(projectServices)
    .where(eq(projectServices.projectId, projectId));

  return rows.map(toProjectServiceRow);
}

export async function listProjectEnvironmentsByProjectIds(projectIds: readonly string[]): Promise<EnvironmentRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  return await getApiDatabase()
    .select()
    .from(environments)
    .where(inArray(environments.projectId, [...projectIds]))
    .orderBy(asc(environments.projectId), asc(environments.name));
}

export async function listProjectServiceCountsByProjectIds(projectIds: string[]): Promise<ProjectServiceCountRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  return await getApiDatabase()
    .select({
      projectId: projectServices.projectId,
      serviceCount: count(projectServices.id),
    })
    .from(projectServices)
    .where(inArray(projectServices.projectId, projectIds))
    .groupBy(projectServices.projectId);
}

export async function updateProjectService(input: UpdateProjectServiceInput): Promise<ProjectServiceRow> {
  const [service] = await getApiDatabase()
    .update(projectServices)
    .set({
      kind: input.kind,
      path: input.path,
      updatedAt: input.updatedAt,
    })
    .where(eq(projectServices.id, input.projectServiceId))
    .returning();

  return toProjectServiceRow(requirePersistedRow(service, 'project service'));
}

export async function createOrGetEnvironment(input: CreateEnvironmentInput): Promise<EnvironmentRow> {
  const [environment]: PersistedEnvironmentRow[] = await getApiDatabase()
    .insert(environments)
    .values(input)
    .onConflictDoNothing({
      target: [environments.projectId, environments.name],
    })
    .returning();

  if (environment !== undefined) {
    return environment;
  }

  return requirePersistedRow(await findEnvironmentByProjectAndName(input.projectId, input.name), 'environment');
}

export async function findEnvironmentByProjectAndName(
  projectId: string,
  environmentName: string,
): Promise<EnvironmentRow | undefined> {
  const rows: EnvironmentRow[] = await getApiDatabase()
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.name, environmentName)))
    .limit(1);

  return rows[0];
}

function requirePersistedRow<TRow>(row: TRow | undefined, label: string): TRow {
  if (row === undefined) {
    throw new Error(`Failed to persist ${label}.`);
  }

  return row;
}
