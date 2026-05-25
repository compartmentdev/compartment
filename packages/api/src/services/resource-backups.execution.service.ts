import type { NodeResourceOperationResponse } from '@compartment/contracts';
import { runNodeResourceBackupOperation, runNodeResourceRestoreOperation } from '@compartment/sdk';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { insertOperationRecordWithExecutor, updateOperationRecordWithExecutor } from '../queries/operations.query';
import type { OperationRecord } from '../queries/operations.query.types';
import {
  completeResourceBackupWithExecutor,
  createResourceBackupWithExecutor,
  failResourceBackupWithExecutor,
} from '../queries/resource-backups.query';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  prepareResourceBackupArtifactDirectory,
  summarizeResourceBackupArtifact,
  type ResourceBackupArtifactSummary,
} from './resource-backup-artifact.service';
import { buildResourceBackupManifest } from './resource-backup-manifest.service';
import {
  buildResourceOperationRequest,
  requireBackupArtifactHostPath,
  resolveBackupOperationContext,
  resolveResourceOperationContext,
  resolveRestoreOperationContext,
  type ResourceBackupOperationContext,
  type ResourceOperationKind,
} from './resource-backups.operation-context.service';
import { createResourceNodeRequester } from './resource-node-requester.service';
import { readOperationErrorOutput, summarizeOperationOutput } from './resource-operation-output.service';
import { serializeResourceDefinitionSnapshot } from './resources.service.storage';
import type {
  ResourceBackupResult,
  ResourceEnvironmentContext,
  RunResourceBackupInput,
  RunResourceRestoreInput,
} from './resources.service.types';

interface RunningResourceBackup {
  backup: ResourceBackupRow;
  operationRecord: OperationRecord;
}

interface ResourceBackupRuntimeState extends RunningResourceBackup {
  artifactHostPath: string;
}

interface CompleteResourceBackupOperationInput {
  artifact: ResourceBackupArtifactSummary;
  operationContext: ResourceBackupOperationContext;
  response: NodeResourceOperationResponse;
  runtimeState: ResourceBackupRuntimeState;
}

export async function runResourceBackup(
  input: RunResourceBackupInput,
): Promise<Pick<ResourceBackupResult, 'backup' | 'manifest'>> {
  const operationContext: ResourceBackupOperationContext = await resolveBackupOperationContext(input);
  const runningBackup: RunningResourceBackup = await createRunningResourceBackup(input);

  try {
    const runtimeState: ResourceBackupRuntimeState = await prepareRunningResourceBackupRuntimeState(runningBackup);
    return await completeResourceBackupOperation(input, operationContext, runtimeState);
  } catch (error) {
    const operationError: Error = error instanceof Error ? error : new Error('Resource backup failed.');
    await failRunningResourceBackup(input, runningBackup, operationError);
    throw createInvalidDeployConfigError(readOperationFailureSummary(operationError));
  }
}

export async function runResourceRestore(input: RunResourceRestoreInput): Promise<void> {
  const operationContext: ResourceBackupOperationContext = await resolveRestoreOperationContext(input);
  const artifactHostPath: string = requireBackupArtifactHostPath(input.backup);

  await runNodeResourceRestoreOperation(
    await createResourceNodeRequester(input.context),
    buildResourceOperationRequest(input.context, input.resource, operationContext, artifactHostPath),
  );
}

export async function assertResourceDefinesOperation(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  operationKind: ResourceOperationKind,
): Promise<void> {
  await resolveResourceOperationContext(context, resource, operationKind);
}

async function completeResourceBackupOperation(
  input: RunResourceBackupInput,
  operationContext: ResourceBackupOperationContext,
  runtimeState: ResourceBackupRuntimeState,
): Promise<Pick<ResourceBackupResult, 'backup' | 'manifest'>> {
  const response: NodeResourceOperationResponse = await runBackupCommand(input, operationContext, runtimeState);
  const artifact: ResourceBackupArtifactSummary = await summarizeResourceBackupArtifact(runtimeState.backup.id);
  const completedBackup: ResourceBackupRow = await persistCompletedResourceBackup(input, {
    artifact,
    operationContext,
    response,
    runtimeState,
  });
  await completeResourceBackupOperationRecord(input, runtimeState.operationRecord, completedBackup);

  return { backup: completedBackup, manifest: completedBackup.manifestJson };
}

async function runBackupCommand(
  input: RunResourceBackupInput,
  operationContext: ResourceBackupOperationContext,
  runtimeState: ResourceBackupRuntimeState,
): Promise<NodeResourceOperationResponse> {
  return await runNodeResourceBackupOperation(
    await createResourceNodeRequester(input.context),
    buildResourceOperationRequest(input.context, input.resource, operationContext, runtimeState.artifactHostPath),
  );
}

async function createRunningResourceBackup(input: RunResourceBackupInput): Promise<RunningResourceBackup> {
  const backupId: string = createId('rbak');
  return await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<RunningResourceBackup> => {
    const operationRecord: OperationRecord = await createRunningResourceBackupOperationRecord(input, tx);
    const backup: ResourceBackupRow = await createResourceBackupWithExecutor(tx, {
      createdByPrincipalId: input.actorPrincipalId,
      id: backupId,
      operationId: operationRecord.id,
      projectResourceId: input.resource.id,
      purpose: input.purpose,
      status: 'running',
    });

    return { backup, operationRecord };
  });
}

async function prepareRunningResourceBackupRuntimeState(
  runningBackup: RunningResourceBackup,
): Promise<ResourceBackupRuntimeState> {
  const artifactHostPath: string = await prepareResourceBackupArtifactDirectory(runningBackup.backup.id);

  return { artifactHostPath, ...runningBackup };
}

async function createRunningResourceBackupOperationRecord(
  input: RunResourceBackupInput,
  tx: ResourceTransaction,
): Promise<OperationRecord> {
  return await insertOperationRecordWithExecutor(tx, {
    ...(input.actorPrincipalId !== null ? { actorPrincipalId: input.actorPrincipalId } : {}),
    status: 'running',
    summary: `Resource ${input.resource.name} backup is running.`,
    targetId: input.resource.id,
    targetType: 'resource',
    type: 'resource.backup',
  });
}

async function persistCompletedResourceBackup(
  input: RunResourceBackupInput,
  completion: CompleteResourceBackupOperationInput,
): Promise<ResourceBackupRow> {
  const manifest: string = buildCompletedBackupManifest(input, completion);
  return await getApiDatabase().transaction(
    async (tx: ResourceTransaction): Promise<ResourceBackupRow> =>
      await completeResourceBackupWithExecutor(tx, {
        artifactLocation: completion.artifact.location,
        backupId: completion.runtimeState.backup.id,
        checksum: completion.artifact.checksum,
        completedAt: new Date(),
        manifestJson: manifest,
        resourceDefinitionJson: serializeResourceDefinitionSnapshot(input.resource),
        sizeBytes: completion.artifact.sizeBytes,
        stderrSummary: summarizeOperationOutput(completion.response.stderr),
        stdoutSummary: summarizeOperationOutput(completion.response.stdout),
      }),
  );
}

function buildCompletedBackupManifest(
  input: RunResourceBackupInput,
  completion: CompleteResourceBackupOperationInput,
): string {
  return JSON.stringify(
    buildResourceBackupManifest(
      input.context,
      input.resource,
      completion.runtimeState.backup,
      completion.operationContext.intent,
      completion.operationContext.operation,
      completion.artifact,
    ),
  );
}

async function completeResourceBackupOperationRecord(
  input: RunResourceBackupInput,
  operationRecord: OperationRecord,
  backup: ResourceBackupRow,
): Promise<void> {
  await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<void> => {
    await updateOperationRecordWithExecutor(tx, {
      completedAt: backup.completedAt,
      operationId: operationRecord.id,
      status: 'succeeded',
      summary: `Resource ${input.resource.name} backup succeeded.`,
    });
  });
}

async function failRunningResourceBackup(
  input: RunResourceBackupInput,
  runningBackup: RunningResourceBackup,
  error: Error,
): Promise<void> {
  await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<void> => {
    const failedBackup: ResourceBackupRow = await failResourceBackupWithExecutor(tx, {
      backupId: runningBackup.backup.id,
      completedAt: new Date(),
      failureSummary: error.message,
      stderrSummary: readOperationErrorOutput(error, 'stderr'),
      stdoutSummary: readOperationErrorOutput(error, 'stdout'),
    });
    await updateOperationRecordWithExecutor(tx, {
      completedAt: failedBackup.completedAt,
      operationId: runningBackup.operationRecord.id,
      status: 'failed',
      summary: error.message,
    });
  });
}

function readOperationFailureSummary(error: Error): string {
  return error.message === '' ? 'Resource backup failed.' : error.message;
}
