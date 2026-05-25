import { and, eq, inArray } from 'drizzle-orm';
import { environments, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  EnvironmentScopeLookupRow,
  EnvironmentScopeTargetRow,
  ProjectEnvironmentScopeLookupRow,
  ProjectScopeLookupRow,
  ProjectScopeTargetRow,
} from './access-scope.query.types';

export async function findEnvironmentById(environmentId: string): Promise<EnvironmentScopeLookupRow | undefined> {
  const rows: EnvironmentScopeLookupRow[] = await getApiDatabase()
    .select({
      id: environments.id,
      name: environments.name,
      organizationId: projects.organizationId,
      projectId: environments.projectId,
      projectName: projects.name,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(environments.id, environmentId))
    .limit(1);

  return rows[0];
}

export async function findProjectById(projectId: string): Promise<ProjectScopeLookupRow | undefined> {
  const rows: ProjectScopeLookupRow[] = await getApiDatabase()
    .select({
      id: projects.id,
      name: projects.name,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return rows[0];
}

export async function findEnvironmentByProjectAndName(
  organizationId: string,
  projectName: string,
  environmentName: string,
): Promise<ProjectEnvironmentScopeLookupRow | undefined> {
  const rows: ProjectEnvironmentScopeLookupRow[] = await getApiDatabase()
    .select({
      id: environments.id,
      name: environments.name,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(projects.name, projectName),
        eq(environments.name, environmentName),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function listProjectIdsByEnvironmentIds(environmentIds: readonly string[]): Promise<string[]> {
  if (environmentIds.length === 0) {
    return [];
  }

  const rows: { projectId: string }[] = await getApiDatabase()
    .select({
      projectId: environments.projectId,
    })
    .from(environments)
    .where(inArray(environments.id, [...environmentIds]));

  return [...new Set(rows.map((row: { projectId: string }): string => row.projectId))];
}

export async function listProjectScopeTargetsByIds(projectIds: readonly string[]): Promise<ProjectScopeTargetRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  return await getApiDatabase()
    .select({
      projectName: projects.name,
      scopeId: projects.id,
    })
    .from(projects)
    .where(inArray(projects.id, [...projectIds]));
}

export async function listEnvironmentScopeTargetsByIds(
  environmentIds: readonly string[],
): Promise<EnvironmentScopeTargetRow[]> {
  if (environmentIds.length === 0) {
    return [];
  }

  return await getApiDatabase()
    .select({
      environmentName: environments.name,
      projectName: projects.name,
      scopeId: environments.id,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(inArray(environments.id, [...environmentIds]));
}
