import {
  createInvalidDeployConfigError,
  createProjectArchivedError,
  createResourceNotFoundError,
  createResourceNameTakenError,
} from '../errors/api-business-error';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import {
  findProjectResourceById,
  lockProjectResourceReconciliation,
  lockProjectResourceReferenceByName,
} from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { assertResourceBackupBelongsToEnvironment } from './resource-backups.environment.service';
import { runResourceRestore } from './resource-backups.execution.service';
import { resolveRequiredBackupResourceById, resolveRequiredResourceBackup } from './resource-backups.lookup.service';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import { withResourceOperationLocks } from './resource-operation-lock.service';
import { copyRestoreResourceVariables } from './resource-backups.restore-variables.service';
import {
  createKubernetesRestoredResourceWithLock,
  prepareRestoredResourceRuntime,
} from './resource-backups.restore-as-kubernetes.service';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import { buildResourceOperationDefinition, type ResolvedResourceIntent } from './resources.service.helpers';
import {
  parseResourceDefinitionSnapshotJson,
  type StoredResourceDefinitionSnapshot,
  type StoredResourceOperationConfig,
} from './resources.service.storage';
import type {
  ResourceEnvironmentContext,
  ResourceRestoreAsInput,
  ResourceRestoreAsResult,
} from './resources.service.types';

interface CreateRestoredResourceInput {
  backup: ResourceBackupRow;
  context: ResourceEnvironmentContext;
  restoreInput: ResourceRestoreAsInput;
  snapshot: StoredResourceDefinitionSnapshot;
  sourceResource: ProjectResourceRow;
}

interface RestoreCreatedResourceInput {
  backup: ResourceBackupRow;
  context: ResourceEnvironmentContext;
  createdResource: ProjectResourceRow;
  sourceResource: ProjectResourceRow;
}

interface RestoreBackupIntoCreatedResourceInput {
  artifactResource: ProjectResourceRow;
  backup: ResourceBackupRow;
  context: ResourceEnvironmentContext;
  resource: ProjectResourceRow;
}

export async function restoreResourceBackupAsForPrincipal(
  input: ResourceRestoreAsInput,
): Promise<ResourceRestoreAsResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');
  const backup: ResourceBackupRow = await resolveRequiredResourceBackup(input.query.backupId);
  const sourceResource: ProjectResourceRow = await resolveRequiredBackupResourceById(backup.projectResourceId);
  assertResourceBackupBelongsToEnvironment(sourceResource, context.environment.id);
  assertBackupCanRestoreToNewResource(backup);

  const createdResource: ProjectResourceRow = await createRestoredResourceFromBackup({
    backup,
    context,
    restoreInput: input,
    snapshot: resolveRequiredResourceDefinitionSnapshot(backup),
    sourceResource,
  });
  const resource: ProjectResourceRow = await withResourceOperationLocks(
    [sourceResource.id, createdResource.id],
    async (): Promise<ProjectResourceRow> =>
      await restoreCreatedResource({ backup, context, createdResource, sourceResource }),
  );

  return { ...context, resource, restoredBackup: backup, sourceResource };
}

async function restoreCreatedResource(input: RestoreCreatedResourceInput): Promise<ProjectResourceRow> {
  const sourceResource: ProjectResourceRow = await requireResourceOperationCandidate(input.sourceResource.id);
  const createdResource: ProjectResourceRow = await requireResourceOperationCandidate(input.createdResource.id);
  const resource: ProjectResourceRow = await prepareRestoredResourceRuntime(input.context, createdResource);
  await restoreBackupIntoCreatedResource({
    artifactResource: sourceResource,
    backup: input.backup,
    context: input.context,
    resource,
  });
  return resource;
}

async function requireResourceOperationCandidate(resourceId: string): Promise<ProjectResourceRow> {
  const resource: ProjectResourceRow | undefined = await findProjectResourceById(resourceId);
  if (resource === undefined || resource.status === 'deleting') {
    throw createResourceNotFoundError();
  }
  return resource;
}

async function restoreBackupIntoCreatedResource(input: RestoreBackupIntoCreatedResourceInput): Promise<void> {
  try {
    await runResourceRestore(input);
  } catch (error) {
    const reason: string = error instanceof Error && error.message !== '' ? error.message : 'Resource restore failed';

    throw createInvalidDeployConfigError(formatRestoreAsFailure(input.resource.name, reason));
  }
}

async function createRestoredResourceFromBackup(input: CreateRestoredResourceInput): Promise<ProjectResourceRow> {
  return await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<ProjectResourceRow> => {
    const targetResourceName: string = input.restoreInput.body.targetResourceName;
    await assertRestoredResourceCreationAllowed(tx, input.context, targetResourceName);
    const effectiveVariables: EffectiveVariable[] = await copyRestoreResourceVariables({
      actorPrincipalId: input.restoreInput.actorPrincipalId,
      context: input.context,
      sourceResourceName: input.sourceResource.name,
      targetResourceName,
      tx,
    });
    const intent: ResolvedResourceIntent = resolveRestoredResourceIntent(
      input.context,
      targetResourceName,
      input.snapshot,
      effectiveVariables,
    );
    preflightRestoreOperation(input.backup, intent, effectiveVariables);
    return await createRestoredResourceWithLock(tx, input.context, intent);
  });
}

async function assertRestoredResourceCreationAllowed(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  resourceName: string,
): Promise<void> {
  const archivedAt: Date | null = await lockProjectResourceReconciliation(tx, context.environment.id, resourceName);
  if (archivedAt !== null) {
    throw createProjectArchivedError();
  }
  await assertTargetResourceAvailable(tx, context, resourceName);
}

function resolveRestoredResourceIntent(
  context: ResourceEnvironmentContext,
  targetResourceName: string,
  snapshot: StoredResourceDefinitionSnapshot,
  effectiveVariables: EffectiveVariable[],
): ResolvedResourceIntent {
  return resolveStoredResourceIntent(createSnapshotResourceRow(snapshot), effectiveVariables, {
    environmentName: context.environment.name,
    projectName: context.project.name,
    resourceName: targetResourceName,
  });
}

async function createRestoredResourceWithLock(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  intent: ResolvedResourceIntent,
): Promise<ProjectResourceRow> {
  return await createKubernetesRestoredResourceWithLock(tx, context, intent);
}

async function assertTargetResourceAvailable(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  resourceName: string,
): Promise<void> {
  const existingResource: ProjectResourceRow | undefined = await lockProjectResourceReferenceByName(
    tx,
    context.environment.id,
    resourceName,
  );
  if (existingResource !== undefined) {
    throw createResourceNameTakenError(`Resource ${resourceName} already exists.`);
  }
}

function createSnapshotResourceRow(snapshot: StoredResourceDefinitionSnapshot): ProjectResourceRow {
  const now: Date = new Date(0);

  return {
    ...createSnapshotResourceIdentity(now),
    commandJson: snapshot.commandJson,
    deleteDataRequested: false,
    envJson: snapshot.envJson,
    image: snapshot.image,
    operationConfigHash: snapshot.operationConfigHash,
    operationsJson: snapshot.operationsJson,
    portsJson: snapshot.portsJson,
    readinessJson: snapshot.readinessJson,
    expectedClaimsJson: '[]',
    runtimeDefinitionHash: snapshot.runtimeDefinitionHash,
    volumesJson: snapshot.volumesJson,
  };
}

type SnapshotResourceIdentity = Pick<
  ProjectResourceRow,
  'createdAt' | 'environmentId' | 'expectedClaimsJson' | 'id' | 'name' | 'status' | 'updatedAt'
>;

function createSnapshotResourceIdentity(now: Date): SnapshotResourceIdentity {
  return {
    createdAt: now,
    environmentId: '',
    expectedClaimsJson: '[]',
    id: '',
    name: '',
    status: 'stopped',
    updatedAt: now,
  };
}

function assertBackupCanRestoreToNewResource(backup: ResourceBackupRow): void {
  if (backup.status === 'succeeded' && backup.manifestJson !== null) {
    return;
  }

  throw createInvalidDeployConfigError(`Backup ${backup.id} cannot be restored into a new resource.`);
}

function preflightRestoreOperation(
  backup: ResourceBackupRow,
  intent: ResolvedResourceIntent,
  effectiveVariables: EffectiveVariable[],
): void {
  const operation: StoredResourceOperationConfig = resolveConfiguredRestoreOperation(backup, intent);

  buildResourceOperationDefinition(intent, operation, effectiveVariables);
}

function resolveConfiguredRestoreOperation(
  backup: ResourceBackupRow,
  intent: ResolvedResourceIntent,
): StoredResourceOperationConfig {
  if (intent.operations.restore !== null) {
    return intent.operations.restore;
  }

  throw createInvalidDeployConfigError(`Backup ${backup.id} cannot restore a resource without a restore operation.`);
}

function resolveRequiredResourceDefinitionSnapshot(backup: ResourceBackupRow): StoredResourceDefinitionSnapshot {
  const snapshot: StoredResourceDefinitionSnapshot | null = parseResourceDefinitionSnapshotJson(
    backup.resourceDefinitionJson,
  );
  if (snapshot !== null) {
    return snapshot;
  }

  throw createInvalidDeployConfigError(
    `Backup ${backup.id} cannot be restored into a new resource because it was created before resource definition snapshots were recorded.`,
  );
}

function formatRestoreAsFailure(resourceName: string, reason: string): string {
  return `Resource ${resourceName} was created, but restore failed: ${reason}. Delete the resource before retrying.`;
}
