import type { NodeResourceRequest, NodeResourceResponse } from '@compartment/contracts';
import { reconcileNodeResource } from '@compartment/sdk';
import { createInvalidDeployConfigError, createResourceNameTakenError } from '../errors/api-business-error';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import {
  createProjectResourceWithExecutor,
  lockProjectResourceReconciliation,
  lockProjectResourceReferenceByName,
  updateProjectResourceRuntimeWithExecutor,
} from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { assertResourceBackupBelongsToEnvironment } from './resource-backups.environment.service';
import { runResourceRestore } from './resource-backups.execution.service';
import { resolveRequiredBackupResourceById, resolveRequiredResourceBackup } from './resource-backups.lookup.service';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import { createResourceNodeRequester } from './resource-node-requester.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import { copyRestoreResourceVariables } from './resource-backups.restore-variables.service';
import { createResourceInsert } from './resources-resource-insert.service';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import {
  buildNodeResourceOperationDefinition,
  buildNodeResourceRequest,
  type ResolvedResourceIntent,
} from './resources.service.helpers';
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

export async function restoreResourceBackupAsForPrincipal(
  input: ResourceRestoreAsInput,
): Promise<ResourceRestoreAsResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const backup: ResourceBackupRow = await resolveRequiredResourceBackup(input.query.backupId);
  const sourceResource: ProjectResourceRow = await resolveRequiredBackupResourceById(backup.projectResourceId);
  assertResourceBackupBelongsToEnvironment(sourceResource, context.environment.id);
  assertBackupCanRestoreToNewResource(backup);

  const resource: ProjectResourceRow = await createRestoredResourceFromBackup({
    backup,
    context,
    restoreInput: input,
    snapshot: resolveRequiredResourceDefinitionSnapshot(backup),
    sourceResource,
  });
  await restoreBackupIntoCreatedResource({ backup, context, resource });

  return { ...context, resource, restoredBackup: backup, sourceResource };
}

async function restoreBackupIntoCreatedResource(input: {
  backup: ResourceBackupRow;
  context: ResourceEnvironmentContext;
  resource: ProjectResourceRow;
}): Promise<void> {
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
    await lockProjectResourceReconciliation(tx, input.context.environment.id, targetResourceName);
    await assertTargetResourceAvailable(tx, input.context, targetResourceName);
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
  const response: NodeResourceResponse = await reconcileNodeResource(
    await createResourceNodeRequester(context),
    createRestoredResourceNodeRequest(context, intent),
  );
  const resource: ProjectResourceRow = await createProjectResourceWithExecutor(
    tx,
    createResourceInsert(context.environment.id, intent, new Date()),
  );

  return await updateProjectResourceRuntimeWithExecutor(tx, {
    containerId: response.containerId,
    projectResourceId: resource.id,
    status: response.status,
    updatedAt: new Date(),
  });
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

function createRestoredResourceNodeRequest(
  context: ResourceEnvironmentContext,
  intent: ResolvedResourceIntent,
): NodeResourceRequest {
  return buildNodeResourceRequest(
    context.project.id,
    context.project.name,
    context.environment.id,
    context.environment.name,
    intent,
  );
}

function createSnapshotResourceRow(snapshot: StoredResourceDefinitionSnapshot): ProjectResourceRow {
  const now: Date = new Date(0);

  return {
    ...createSnapshotResourceIdentity(now),
    commandJson: snapshot.commandJson,
    envJson: snapshot.envJson,
    image: snapshot.image,
    operationConfigHash: snapshot.operationConfigHash,
    operationsJson: snapshot.operationsJson,
    portsJson: snapshot.portsJson,
    readinessJson: snapshot.readinessJson,
    restartPolicy: snapshot.restartPolicy,
    runtimeDefinitionHash: snapshot.runtimeDefinitionHash,
    volumesJson: snapshot.volumesJson,
  };
}

function createSnapshotResourceIdentity(
  now: Date,
): Pick<
  ProjectResourceRow,
  'containerId' | 'createdAt' | 'environmentId' | 'hostname' | 'id' | 'name' | 'status' | 'updatedAt'
> {
  return {
    containerId: null,
    createdAt: now,
    environmentId: '',
    hostname: '',
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

  buildNodeResourceOperationDefinition(intent, operation, effectiveVariables);
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
