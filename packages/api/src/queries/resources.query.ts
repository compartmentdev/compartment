import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { environments, projectKubeProvisioning, projectResources, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { lockResourceReconcileProject } from './resource-reconcile-project.query';
import type {
  CreateProjectResourceInput,
  PersistedProjectResourceRow,
  ProjectResourceRow,
  ResourceTransaction,
  UpdateProjectResourceIntentInput,
  UpdateProjectResourceStatusInput,
} from './resources.query.types';

const projectResourceLockSelection: SQL[] = [
  sql`${projectResources.commandJson} as "commandJson"`,
  sql`${projectResources.createdAt} as "createdAt"`,
  sql`${projectResources.deleteDataRequested} as "deleteDataRequested"`,
  sql`${projectResources.envJson} as "envJson"`,
  sql`${projectResources.environmentId} as "environmentId"`,
  sql`${projectResources.expectedClaimsJson} as "expectedClaimsJson"`,
  sql`${projectResources.id} as "id"`,
  sql`${projectResources.image} as "image"`,
  sql`${projectResources.name} as "name"`,
  sql`${projectResources.operationConfigHash} as "operationConfigHash"`,
  sql`${projectResources.operationsJson} as "operationsJson"`,
  sql`${projectResources.outputsJson} as "outputsJson"`,
  sql`${projectResources.portsJson} as "portsJson"`,
  sql`${projectResources.readinessJson} as "readinessJson"`,
  sql`${projectResources.runtimeDefinitionHash} as "runtimeDefinitionHash"`,
  sql`${projectResources.status} as "status"`,
  sql`${projectResources.updatedAt} as "updatedAt"`,
  sql`${projectResources.volumesJson} as "volumesJson"`,
];

export async function listProjectResourcesByEnvironmentId(environmentId: string): Promise<ProjectResourceRow[]> {
  const rows: PersistedProjectResourceRow[] = await getApiDatabase()
    .select()
    .from(projectResources)
    .where(eq(projectResources.environmentId, environmentId))
    .orderBy(asc(projectResources.name));

  return rows.map(toProjectResourceRow);
}

export async function findProjectResourceByName(
  environmentId: string,
  resourceName: string,
): Promise<ProjectResourceRow | undefined> {
  const rows: PersistedProjectResourceRow[] = await getApiDatabase()
    .select()
    .from(projectResources)
    .where(and(eq(projectResources.environmentId, environmentId), eq(projectResources.name, resourceName)))
    .limit(1);

  return rows[0] !== undefined ? toProjectResourceRow(rows[0]) : undefined;
}

export async function lockProjectResourceReferenceByName(
  tx: ResourceTransaction,
  environmentId: string,
  resourceName: string,
): Promise<ProjectResourceRow | undefined> {
  const rows: object[] = (await tx.execute(buildLockProjectResourceReferenceQuery(environmentId, resourceName))).rows;
  const resource: PersistedProjectResourceRow | undefined = rows[0] as PersistedProjectResourceRow | undefined;

  return resource !== undefined ? toProjectResourceRow(resource) : undefined;
}

export async function findProjectResourceById(projectResourceId: string): Promise<ProjectResourceRow | undefined> {
  const rows: PersistedProjectResourceRow[] = await getApiDatabase()
    .select()
    .from(projectResources)
    .where(eq(projectResources.id, projectResourceId))
    .limit(1);

  return rows[0] !== undefined ? toProjectResourceRow(rows[0]) : undefined;
}

export async function lockProjectResourceByName(
  tx: ResourceTransaction,
  environmentId: string,
  resourceName: string,
): Promise<ProjectResourceRow | undefined> {
  const rows: object[] = (await tx.execute(buildLockProjectResourceQuery(environmentId, resourceName))).rows;
  const resource: PersistedProjectResourceRow | undefined = rows[0] as PersistedProjectResourceRow | undefined;

  return resource !== undefined ? toProjectResourceRow(resource) : undefined;
}

export async function lockProjectResourceReconciliation(
  tx: ResourceTransaction,
  environmentId: string,
  resourceName: string,
): Promise<Date | null> {
  await lockProjectResourceIdentity(tx, environmentId, resourceName);
  await tx
    .select({ projectId: projectKubeProvisioning.projectId })
    .from(environments)
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .where(eq(environments.id, environmentId))
    .for('update', { of: projectKubeProvisioning });
  const [project] = await tx
    .select({ archivedAt: projects.archivedAt })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(environments.id, environmentId))
    .for('update', { of: projects });
  if (project === undefined) {
    throw new Error(`Project for environment ${environmentId} was not found.`);
  }
  return project.archivedAt;
}

export async function lockProjectResourceOperation(
  tx: ResourceTransaction,
  environmentId: string,
  resourceName: string,
): Promise<Date | null> {
  await lockProjectResourceIdentity(tx, environmentId, resourceName);
  const [project] = await tx
    .select({ archivedAt: projects.archivedAt })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(environments.id, environmentId))
    .for('key share', { of: projects });
  if (project === undefined) {
    throw new Error(`Project for environment ${environmentId} was not found.`);
  }
  return project.archivedAt;
}

export async function lockProjectResourceIdentity(
  tx: ResourceTransaction,
  environmentId: string,
  resourceName: string,
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext(${`${environmentId}:${resourceName}`}))
  `);
}

export async function createProjectResourceWithExecutor(
  tx: ResourceTransaction,
  input: CreateProjectResourceInput,
): Promise<ProjectResourceRow> {
  const [resource] = await tx.insert(projectResources).values(input).returning();

  return requireProjectResourceRow(resource !== undefined ? toProjectResourceRow(resource) : undefined);
}

export async function updateProjectResourceIntentWithExecutor(
  tx: ResourceTransaction,
  input: UpdateProjectResourceIntentInput,
): Promise<ProjectResourceRow> {
  const [resource] = await tx
    .update(projectResources)
    .set(projectResourceIntentUpdate(input))
    .where(eq(projectResources.id, input.projectResourceId))
    .returning();

  return requireProjectResourceRow(resource !== undefined ? toProjectResourceRow(resource) : undefined);
}

function projectResourceIntentUpdate(
  input: UpdateProjectResourceIntentInput,
): Omit<UpdateProjectResourceIntentInput, 'projectResourceId'> {
  const update: Partial<UpdateProjectResourceIntentInput> = { ...input };
  Reflect.deleteProperty(update, 'projectResourceId');
  return update as Omit<UpdateProjectResourceIntentInput, 'projectResourceId'>;
}

export async function updateProjectResourceStatus(
  input: UpdateProjectResourceStatusInput,
): Promise<ProjectResourceRow> {
  return await getApiDatabase().transaction(
    async (tx: ResourceTransaction): Promise<ProjectResourceRow> =>
      await updateProjectResourceStatusWithExecutor(tx, input),
  );
}

export async function beginProjectResourceDeletion(
  projectResourceId: string,
  deleteData: boolean,
): Promise<ProjectResourceRow> {
  return await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<ProjectResourceRow> => {
    await lockResourceReconcileProject(tx, projectResourceId);
    const [resource] = await tx
      .update(projectResources)
      .set({
        deleteDataRequested: sql`${projectResources.deleteDataRequested} OR ${deleteData}`,
        status: 'deleting',
        updatedAt: new Date(),
      })
      .where(eq(projectResources.id, projectResourceId))
      .returning();
    return requireProjectResourceRow(resource === undefined ? undefined : toProjectResourceRow(resource));
  });
}

async function updateProjectResourceStatusWithExecutor(
  tx: ResourceTransaction,
  input: UpdateProjectResourceStatusInput,
): Promise<ProjectResourceRow> {
  const [resource] = await tx
    .update(projectResources)
    .set({
      status: input.status,
      updatedAt: input.updatedAt,
    })
    .where(eq(projectResources.id, input.projectResourceId))
    .returning();

  return requireProjectResourceRow(resource !== undefined ? toProjectResourceRow(resource) : undefined);
}

function buildLockProjectResourceQuery(environmentId: string, resourceName: string): SQL<PersistedProjectResourceRow> {
  return sql<PersistedProjectResourceRow>`
    select ${sql.join(projectResourceLockSelection, sql`, `)}
    from ${projectResources}
    where ${projectResources.environmentId} = ${environmentId}
      and ${projectResources.name} = ${resourceName}
    for update
  `;
}

function buildLockProjectResourceReferenceQuery(
  environmentId: string,
  resourceName: string,
): SQL<PersistedProjectResourceRow> {
  return sql<PersistedProjectResourceRow>`
    select ${sql.join(projectResourceLockSelection, sql`, `)}
    from ${projectResources}
    where ${projectResources.environmentId} = ${environmentId}
      and ${projectResources.name} = ${resourceName}
    for key share
  `;
}

export function toProjectResourceRow(row: PersistedProjectResourceRow): ProjectResourceRow {
  return {
    ...row,
    createdAt: readProjectResourceDate(row.createdAt),
    updatedAt: readProjectResourceDate(row.updatedAt),
  };
}

function readProjectResourceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function requireProjectResourceRow(row: ProjectResourceRow | undefined): ProjectResourceRow {
  if (row === undefined) {
    throw new Error('Failed to persist project resource.');
  }

  return row;
}
