import {
  findFirstFairQueuedDeploymentCandidate,
  markQueuedDeploymentRunningWithExecutor,
  readBuildQueueCounts,
} from '../queries/deployment-claim.query';
import { lockActiveDeploymentProjectsWithExecutor } from '../queries/deployments.query';
import type { BuildQueueCountsRow, QueuedDeploymentClaimCandidateRow } from '../queries/deployment-claim.query.types';
import type { DeploymentRow, DeploymentTransaction } from '../queries/deployments.query.types';
import { updateOperationRecordWithExecutor } from '../queries/operations.query';
import { getApiDatabase } from '../runtime/runtime-access';
import { reserveDeploymentPublicRouteWithExecutor } from './deployment-route.service';
import type { DeploymentPublicRouteReservationContext } from './deployment-route.service.types';
import { buildClaimedDeploymentContext } from './deployment-worker-state.service';
import type { ClaimedDeploymentContext } from './deployments.service.types';
import type {
  BuildQueueClaimInput,
  BuildQueueObservation,
  ClaimedDeploymentBuildQueueResult,
  ClaimedDeploymentReservation,
} from './deployment-worker-claim.service.types';

export async function claimQueuedDeploymentForWorker(
  input: BuildQueueClaimInput,
): Promise<ClaimedDeploymentBuildQueueResult> {
  const claimed: ClaimedDeploymentReservation | null = await claimQueuedDeploymentReservation(input);
  if (claimed === null) {
    return await readUnclaimedBuildQueueResult();
  }

  const deployment: ClaimedDeploymentContext = await buildClaimedDeploymentContext(claimed.deploymentId);
  return { deployment, queue: claimed.queue };
}

async function claimQueuedDeploymentReservation(
  input: BuildQueueClaimInput,
): Promise<ClaimedDeploymentReservation | null> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<ClaimedDeploymentReservation | null> =>
      await claimQueuedDeploymentWithReservation(tx, input, new Date()),
  );
}

async function claimQueuedDeploymentWithReservation(
  tx: DeploymentTransaction,
  input: BuildQueueClaimInput,
  now: Date,
): Promise<ClaimedDeploymentReservation | null> {
  const candidate: QueuedDeploymentClaimCandidateRow | undefined = await findFirstFairQueuedDeploymentCandidate(
    tx,
    input.maximumConcurrentBuilds,
    input.maximumConcurrentBuildsPerOrganization,
  );
  if (candidate === undefined) {
    return null;
  }
  if (!(await lockActiveDeploymentProjectsWithExecutor(tx, [candidate.environmentId]))) {
    return null;
  }

  return await reserveClaimedDeploymentRoute(tx, candidate, now);
}

async function reserveClaimedDeploymentRoute(
  tx: DeploymentTransaction,
  candidate: QueuedDeploymentClaimCandidateRow,
  now: Date,
): Promise<ClaimedDeploymentReservation | null> {
  const deployment: DeploymentRow | undefined = await markQueuedDeploymentRunningWithExecutor(
    tx,
    candidate.deploymentId,
    now,
  );
  if (deployment === undefined) {
    return null;
  }

  await markClaimedDeploymentOperationRunning(tx, deployment.operationId, candidate.organizationId);
  await reserveDeploymentPublicRouteWithExecutor(
    tx,
    buildDeploymentPublicRouteReservationContext(candidate, deployment.id, now),
  );

  const counts: BuildQueueCountsRow = await readBuildQueueCounts(tx);
  return {
    createdAt: candidate.createdAt,
    deploymentId: deployment.id,
    queue: buildQueueObservation(counts, Math.max(0, now.getTime() - new Date(candidate.createdAt).getTime())),
  };
}

async function markClaimedDeploymentOperationRunning(
  tx: DeploymentTransaction,
  operationId: string,
  organizationId: string,
): Promise<void> {
  await updateOperationRecordWithExecutor(tx, {
    operationId,
    organizationId,
    status: 'running',
  });
}

async function readUnclaimedBuildQueueResult(): Promise<ClaimedDeploymentBuildQueueResult> {
  const queue: BuildQueueObservation = await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<BuildQueueObservation> =>
      buildQueueObservation(await readBuildQueueCounts(tx), null),
  );
  return { deployment: null, queue };
}

function buildQueueObservation(counts: BuildQueueCountsRow, waitTimeMs: number | null): BuildQueueObservation {
  return {
    activeBuildCount: counts.activeBuildCount,
    queueDepth: counts.queueDepth,
    waitTimeMs,
  };
}

function buildDeploymentPublicRouteReservationContext(
  candidate: QueuedDeploymentClaimCandidateRow,
  deploymentId: string,
  updatedAt: Date,
): DeploymentPublicRouteReservationContext {
  return {
    deploymentId,
    environmentId: candidate.environmentId,
    environmentName: candidate.environmentName,
    organizationId: candidate.organizationId,
    projectName: candidate.projectName,
    serviceId: candidate.serviceId,
    serviceName: candidate.serviceName,
    updatedAt,
  };
}
