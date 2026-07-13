import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { projectKubeProvisioning, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  CreateProjectInput,
  PersistedProjectRow,
  ProjectRow,
  ProjectsMutationTransaction,
  ProjectsReadExecutor,
  ProjectsWriteExecutor,
  RenameProjectInput,
  SetProjectArchivedAtInput,
} from './projects.query.types';

export async function createOrGetProject(input: CreateProjectInput): Promise<ProjectRow> {
  return await getApiDatabase().transaction(
    async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> =>
      await createOrGetProjectWithExecutor(transaction, input),
  );
}

export async function createOrGetProjectWithExecutor(
  executor: ProjectsWriteExecutor,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  const [project]: PersistedProjectRow[] = await executor
    .insert(projects)
    .values(input)
    .onConflictDoNothing({
      target: [projects.organizationId, projects.name],
    })
    .returning();

  const persisted: ProjectRow =
    project ??
    requirePersistedRow(
      await findProjectByOrganizationAndNameWithExecutor(executor, input.organizationId, input.name),
      'project',
    );
  await executor.insert(projectKubeProvisioning).values({ projectId: persisted.id }).onConflictDoNothing();
  return persisted;
}

export async function listProjectsByOrganization(
  organizationId: string,
  includeArchived: boolean,
): Promise<ProjectRow[]> {
  return await getApiDatabase()
    .select()
    .from(projects)
    .where(
      includeArchived
        ? eq(projects.organizationId, organizationId)
        : and(eq(projects.organizationId, organizationId), isNull(projects.archivedAt)),
    )
    .orderBy(asc(projects.name));
}

export async function listProjectsByIds(organizationId: string, projectIds: string[]): Promise<ProjectRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  const rows: ProjectRow[] = await getApiDatabase()
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), inArray(projects.id, projectIds)));

  const rowsById: Map<string, ProjectRow> = new Map<string, ProjectRow>(
    rows.map((project: ProjectRow): [string, ProjectRow] => [project.id, project]),
  );
  return projectIds.flatMap((projectId: string): ProjectRow[] => {
    const project: ProjectRow | undefined = rowsById.get(projectId);
    return project === undefined ? [] : [project];
  });
}

export async function findProjectByOrganizationAndName(
  organizationId: string,
  projectName: string,
): Promise<ProjectRow | undefined> {
  return await findProjectByOrganizationAndNameWithExecutor(getApiDatabase(), organizationId, projectName);
}

export async function findProjectByOrganizationAndNameWithExecutor(
  executor: ProjectsReadExecutor,
  organizationId: string,
  projectName: string,
): Promise<ProjectRow | undefined> {
  const rows: ProjectRow[] = await executor
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.name, projectName)))
    .limit(1);

  return rows[0];
}

export async function renameProjectWithExecutor(
  executor: ProjectsWriteExecutor,
  input: RenameProjectInput,
): Promise<ProjectRow> {
  const [project]: PersistedProjectRow[] = await executor
    .update(projects)
    .set({
      name: input.name,
      updatedAt: input.updatedAt,
    })
    .where(eq(projects.id, input.projectId))
    .returning();

  return requirePersistedRow(project, 'project');
}

export async function setProjectArchivedAt(input: SetProjectArchivedAtInput): Promise<ProjectRow> {
  return await setProjectArchivedAtWithExecutor(getApiDatabase(), input);
}

export async function setProjectArchivedAtWithExecutor(
  executor: ProjectsWriteExecutor,
  input: SetProjectArchivedAtInput,
): Promise<ProjectRow> {
  const [project]: PersistedProjectRow[] = await executor
    .update(projects)
    .set({
      archivedAt: input.archivedAt,
      updatedAt: input.updatedAt,
    })
    .where(eq(projects.id, input.projectId))
    .returning();

  return requirePersistedRow(project, 'project');
}

export async function findProjectByIdWithExecutor(
  executor: Pick<Database, 'select'>,
  projectId: string,
): Promise<ProjectRow | undefined> {
  const rows: ProjectRow[] = await executor.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return rows[0];
}

export async function deleteProjectWithExecutor(
  executor: ProjectsMutationTransaction,
  projectId: string,
): Promise<ProjectRow> {
  const [project]: PersistedProjectRow[] = await executor
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning();
  return requirePersistedRow(project, 'project');
}

export async function lockProjectMutationWithExecutor(
  executor: ProjectsMutationTransaction,
  projectId: string,
): Promise<void> {
  await executor.execute(sql`select ${projects.id} from ${projects} where ${projects.id} = ${projectId} for update`);
}

function requirePersistedRow<TRow>(row: TRow | undefined, label: string): TRow {
  if (row === undefined) {
    throw new Error(`Failed to persist ${label}.`);
  }

  return row;
}
