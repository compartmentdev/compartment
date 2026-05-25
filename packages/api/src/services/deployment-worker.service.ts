import {
  buildDeploymentDrainDeadline,
  buildNodeDrainDeploymentRequest,
  buildNodeInspectReadinessFields,
  type NodeInspectDeploymentQuery,
  type NodeInspectDeploymentResponse,
  type NodeInspectedDeployment,
  type ResolvedOptionalServiceReadinessConfig,
  type RuntimeDrainState,
  type WorkerArtifactCleanupTarget,
  type WorkerCompleteDeploymentRequest,
  type WorkerCompleteDeploymentResponse,
  type WorkerFailDeploymentRequest,
  type WorkerRecoverDeploymentsMode,
  type WorkerRecoverDeploymentsResponse,
} from '@compartment/contracts';
import { drainNodeDeployment, inspectNodeDeployment } from '@compartment/sdk';
import { isApiBusinessError } from '../errors/api-business-error';
import { findJoinedDeploymentById } from '../queries/deployment-joined.query';
import { updateDeploymentRuntimeState } from '../queries/deployments.query';
import { findNodeById } from '../queries/node.query';
import { getApiConfig } from '../runtime/runtime-access';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import type { NodeRow } from '../queries/node.query.types';
import { requireJoinedDeployment, requireNode } from './deployment-context.service';
import { parseResolvedReadiness } from './deployment-readiness.service';
import type { ClaimedDeploymentContext } from './deployments.service.types';
import {
  buildRecoveredDeploymentResult,
  type RecoveryOutcomeSummary,
  summarizeRecoveryOutcomes,
  toWorkerRecoverDeploymentsResponse,
  type OrphanedDeploymentRecoveryOutcome,
  type RecoveredCompletionResult,
  type RecoveredDeploymentResult,
} from './deployment-worker-recovery.service';
import {
  appendRuntimeEvent,
  finalizeCompletedDeployment,
  finalizeFailedDeployment,
} from './deployment-worker-finalization.service';
import {
  isPendingDrainDeployment,
  isRunningDeploymentPendingCompletion,
  listDeploymentsNeedingWorkerRecovery,
  readDeploymentDrainState,
  resolvePreviousActiveDeploymentForRecovery,
} from './deployment-worker-state.service';
import { claimQueuedDeploymentForWorker as claimQueuedDeploymentForWorkerInternal } from './deployment-worker-claim.service';
import { readNullableDeploymentUpstreamHost } from './deployment-upstream.service';
import { createNodeRuntimeRequester } from './node-runtime-requester';

const orphanedDeploymentRecoveryFailureMessage: string =
  'Deployment failed because the worker lost track of it before the runtime container became active.';
type RecoveredDrainFields = Partial<Pick<WorkerCompleteDeploymentRequest, 'drain'>>;

export async function claimQueuedDeploymentForWorker(): Promise<ClaimedDeploymentContext | null> {
  return await claimQueuedDeploymentForWorkerInternal();
}

export async function recoverOrphanedRunningDeploymentsForWorker(
  mode: WorkerRecoverDeploymentsMode,
): Promise<WorkerRecoverDeploymentsResponse> {
  const recoveryIds: string[] = await listDeploymentsNeedingWorkerRecovery(mode);
  const recoveryOutcomes: OrphanedDeploymentRecoveryOutcome[] = [];

  for (const deploymentId of recoveryIds) {
    recoveryOutcomes.push(await recoverOrphanedDeploymentSafely(deploymentId));
  }
  const summary: RecoveryOutcomeSummary = summarizeRecoveryOutcomes(recoveryOutcomes);
  if (summary.firstRecoveryError !== null) {
    throw summary.firstRecoveryError;
  }

  return toWorkerRecoverDeploymentsResponse(summary);
}

export async function completeQueuedDeployment(
  input: WorkerCompleteDeploymentRequest,
): Promise<WorkerCompleteDeploymentResponse> {
  const cleanupArtifacts: WorkerArtifactCleanupTarget[] = await finalizeCompletedDeployment(input);

  return {
    cleanupArtifacts,
  };
}

export async function failQueuedDeployment(input: WorkerFailDeploymentRequest): Promise<void> {
  await finalizeFailedDeployment(input);
}

async function recoverOrphanedDeploymentSafely(deploymentId: string): Promise<OrphanedDeploymentRecoveryOutcome> {
  try {
    const recoveryResult: RecoveredDeploymentResult = await recoverOrphanedRunningDeployment(deploymentId);

    return {
      error: null,
      ...recoveryResult,
    };
  } catch (error) {
    return {
      cleanupArtifacts: [],
      error: error instanceof Error ? error : new Error('Unexpected orphaned deployment recovery failure.'),
      recovered: false,
    };
  }
}

async function recoverOrphanedRunningDeployment(deploymentId: string): Promise<RecoveredDeploymentResult> {
  const deployment: DeploymentJoinedRow = requireJoinedDeployment(
    await findJoinedDeploymentById(deploymentId, getApiConfig().baseDomain),
  );
  if (isPendingDrainDeployment(deployment)) {
    return await recoverPendingDrainDeployment(deployment);
  }
  if (!isRunningDeploymentPendingCompletion(deployment)) {
    return buildRecoveredDeploymentResult(false);
  }

  const node: NodeRow = requireNode(await findNodeById(deployment.deployment.nodeId));
  const runtimeResponse: NodeInspectDeploymentResponse = await inspectNodeDeployment(
    createNodeRuntimeRequester(node.nodeSocketPath),
    buildNodeInspectDeploymentQuery(deployment),
  );
  const runtime: NodeInspectedDeployment | null = runtimeResponse.deployment;
  if (runtime === null) {
    await finalizeFailedDeployment({
      deploymentId: deployment.deployment.id,
      message: orphanedDeploymentRecoveryFailureMessage,
    });

    return buildRecoveredDeploymentResult(true);
  }

  return await completeRecoveredDeployment(deployment, runtime);
}

async function completeRecoveredDeployment(
  deployment: DeploymentJoinedRow,
  runtime: NodeInspectedDeployment,
): Promise<RecoveredDeploymentResult> {
  const previousDeployment: DeploymentJoinedRow | null = await resolvePreviousActiveDeploymentForRecovery(deployment);
  const completionInput: WorkerCompleteDeploymentRequest = buildRecoveredCompletionInput(
    deployment,
    runtime,
    previousDeployment,
  );
  const completionResult: RecoveredCompletionResult = await persistRecoveredCompletion(completionInput);
  if (completionResult.handled === false) {
    return buildRecoveredDeploymentResult(true);
  }

  const recovered: boolean = await recoverDeploymentDrainIfNeeded(deployment, completionInput);

  return buildRecoveredDeploymentResult(recovered, completionResult.cleanupArtifacts);
}

function buildRecoveredCompletionInput(
  deployment: DeploymentJoinedRow,
  runtime: NodeInspectedDeployment,
  previousDeployment: DeploymentJoinedRow | null,
): WorkerCompleteDeploymentRequest {
  return {
    containerId: runtime.containerId,
    deploymentId: deployment.deployment.id,
    ...buildRecoveredDrainFields(previousDeployment),
    imageRef: runtime.imageRef,
    routeHost: runtime.routeHost,
    upstreamHost: runtime.upstreamHost,
    upstreamPort: runtime.upstreamPort,
  };
}

function buildRecoveredDrainFields(previousDeployment: DeploymentJoinedRow | null): RecoveredDrainFields {
  if (previousDeployment === null) {
    return {};
  }

  const previousContainerId: string | null = previousDeployment.deployment.containerId;
  if (previousContainerId === null) {
    return {};
  }

  return {
    drain: {
      drainDeadlineAt: buildDeploymentDrainDeadline(),
      drainingContainerId: previousContainerId,
      drainingDeploymentId: previousDeployment.deployment.id,
      drainingNodeId: previousDeployment.deployment.nodeId,
    },
  };
}

async function persistRecoveredCompletion(
  completionInput: WorkerCompleteDeploymentRequest,
): Promise<RecoveredCompletionResult> {
  try {
    return {
      cleanupArtifacts: await finalizeCompletedDeployment(completionInput),
      handled: true,
    };
  } catch (error) {
    if (!wasRecoveredArchivedProject(error instanceof Error ? error : null)) {
      throw error;
    }

    return {
      cleanupArtifacts: [],
      handled: false,
    };
  }
}

async function recoverDeploymentDrainIfNeeded(
  deployment: DeploymentJoinedRow,
  completionInput: WorkerCompleteDeploymentRequest,
): Promise<boolean> {
  if (completionInput.drain === undefined) {
    return true;
  }

  const refreshedDeployment: DeploymentJoinedRow = requireJoinedDeployment(
    await findJoinedDeploymentById(deployment.deployment.id, getApiConfig().baseDomain),
  );
  return (await recoverPendingDrainDeployment(refreshedDeployment)).recovered;
}

async function recoverPendingDrainDeployment(deployment: DeploymentJoinedRow): Promise<RecoveredDeploymentResult> {
  const drain: RuntimeDrainState | null = readDeploymentDrainState(deployment);
  if (!isPendingDrainDeployment(deployment) || drain === null) {
    return buildRecoveredDeploymentResult(false);
  }

  const node: NodeRow = requireNode(await findNodeById(drain.drainingNodeId));

  await drainNodeDeployment(createNodeRuntimeRequester(node.nodeSocketPath), buildNodeDrainDeploymentRequest(drain));

  await markDeploymentDrainCompleted(deployment);
  await appendRuntimeEvent(deployment, 'drain completed', 'draining_previous', 'succeeded');

  return buildRecoveredDeploymentResult(true);
}

async function markDeploymentDrainCompleted(deployment: DeploymentJoinedRow): Promise<void> {
  const upstreamHost: string | null = readNullableDeploymentUpstreamHost(
    deployment.deployment.upstreamHost,
    deployment.deployment.upstreamPort,
  );

  await updateDeploymentRuntimeState({
    ...(deployment.deployment.containerId !== null ? { containerId: deployment.deployment.containerId } : {}),
    deploymentId: deployment.deployment.id,
    drainDeadlineAt: null,
    drainingContainerId: null,
    drainingDeploymentId: null,
    drainingNodeId: null,
    promotionStage: 'active',
    ...(upstreamHost !== null ? { upstreamHost } : {}),
    ...(deployment.deployment.upstreamPort !== null ? { upstreamPort: deployment.deployment.upstreamPort } : {}),
    updatedAt: new Date(),
  });
}

function wasRecoveredArchivedProject(error: Error | null): boolean {
  const businessError: Error | null = error;
  return isApiBusinessError(businessError) && businessError.code === 'project_archived';
}

function buildNodeInspectDeploymentQuery(deployment: DeploymentJoinedRow): NodeInspectDeploymentQuery {
  const readiness: ResolvedOptionalServiceReadinessConfig = parseResolvedReadiness(
    deployment.deployment.resolvedReadinessJson,
  );

  return {
    deploymentId: deployment.deployment.id,
    environmentName: deployment.environment.name,
    projectName: deployment.project.name,
    serviceName: deployment.service.name,
    ...buildNodeInspectReadinessFields(readiness),
  };
}
