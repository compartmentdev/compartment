import type {
  DeploymentLogStream,
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
  WorkerArtifactCleanupTarget,
  WorkerCompleteDeploymentRequest,
  WorkerFailDeploymentRequest,
} from '@compartment/contracts';
import { stopNodeDeployment } from '@compartment/sdk';
import { createProjectArchiveRuntimeStopFailedError, createProjectArchivedError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { findJoinedDeploymentById } from '../queries/deployment-joined.query';
import { appendDeploymentRunEvent } from '../queries/deployment-run-events.query';
import { markDeploymentFailed, updateBuildArtifactImage } from '../queries/deployments.query';
import { findNodeById } from '../queries/node.query';
import { updateOperationRecord } from '../queries/operations.query';
import { getApiConfig } from '../runtime/runtime-access';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import type { NodeRow } from '../queries/node.query.types';
import { persistCompletedDeployment } from './deployment-completion.service';
import { requireJoinedDeployment, requireNode } from './deployment-context.service';
import { createNodeRuntimeRequester } from './node-runtime-requester';
import { cleanupDeploymentSourceArchive } from './source-archive-cleanup.service';
import type { DeploymentArtifactCleanupTarget } from './deployment-retention.service.types';

export async function finalizeCompletedDeployment(
  input: WorkerCompleteDeploymentRequest,
): Promise<WorkerArtifactCleanupTarget[]> {
  const deployment: DeploymentJoinedRow = requireJoinedDeployment(
    await findJoinedDeploymentById(input.deploymentId, getApiConfig().baseDomain),
  );
  if (deployment.project.archivedAt !== null) {
    await finalizeArchivedProjectCompletion(deployment, input);
    throw createProjectArchivedError();
  }

  const cleanupTargets: DeploymentArtifactCleanupTarget[] = await persistCompletedDeployment(deployment, input);
  await appendRuntimeEvent(deployment, 'route switched', 'switching_route', 'succeeded');

  return cleanupTargets.map(buildWorkerArtifactCleanupTarget);
}

export async function finalizeFailedDeployment(input: WorkerFailDeploymentRequest): Promise<void> {
  const deployment: DeploymentJoinedRow = requireJoinedDeployment(
    await findJoinedDeploymentById(input.deploymentId, getApiConfig().baseDomain),
  );
  const now: Date = new Date();
  await persistFailedDeployment(deployment, input, now);
}

export async function appendRuntimeEvent(
  deployment: DeploymentJoinedRow,
  message: string,
  stepKey: DeploymentRunStepKey,
  status: DeploymentRunStepStatus,
  level: DeploymentRunLogLevel = 'info',
  stream: DeploymentLogStream = 'compartment',
): Promise<void> {
  await appendDeploymentRunEvent({
    createdAt: new Date(),
    deploymentId: deployment.deployment.id,
    deploymentRunId: deployment.deployment.deploymentRunId,
    id: createId('drev'),
    level,
    message,
    status,
    stepKey,
    stream,
  });
}

async function finalizeArchivedProjectCompletion(
  deployment: DeploymentJoinedRow,
  input: WorkerCompleteDeploymentRequest,
): Promise<void> {
  await stopArchivedProjectDeployment(deployment, input.containerId);
  await persistFailedDeployment(
    deployment,
    {
      deploymentId: input.deploymentId,
      imageRef: input.imageRef,
      message: buildArchivedProjectCompletionFailureMessage(deployment.deployment.id),
    },
    new Date(),
  );
}

async function stopArchivedProjectDeployment(deployment: DeploymentJoinedRow, containerId: string): Promise<void> {
  const node: NodeRow = requireNode(await findNodeById(deployment.deployment.nodeId));

  try {
    await stopNodeDeployment(createNodeRuntimeRequester(node.nodeSocketPath), { containerId });
  } catch {
    throw createProjectArchiveRuntimeStopFailedError();
  }
}

function buildArchivedProjectCompletionFailureMessage(deploymentId: string): string {
  return `Deployment ${deploymentId} could not be activated because the project was archived.`;
}

async function persistFailedDeployment(
  deployment: DeploymentJoinedRow,
  input: WorkerFailDeploymentRequest,
  now: Date,
): Promise<void> {
  if (input.imageRef !== undefined) {
    await updateBuildArtifactImage({
      imageRef: input.imageRef,
      buildArtifactId: deployment.artifact.id,
      updatedAt: now,
    });
  }

  await markDeploymentFailed({
    completedAt: now,
    deploymentId: input.deploymentId,
    failureMessage: input.message,
    updatedAt: now,
  });
  await updateFailedDeploymentOperation(deployment.operation.id, input.message, now);
  await cleanupDeploymentSourceArchive(deployment.artifact);
}

async function updateFailedDeploymentOperation(operationId: string, summary: string, completedAt: Date): Promise<void> {
  await updateOperationRecord({
    completedAt,
    operationId,
    status: 'failed',
    summary,
  });
}

function buildWorkerArtifactCleanupTarget(target: DeploymentArtifactCleanupTarget): WorkerArtifactCleanupTarget {
  return {
    imageRef: target.imageRef,
  };
}
