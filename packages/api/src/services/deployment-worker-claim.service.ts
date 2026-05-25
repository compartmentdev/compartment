import {
  findFirstFairQueuedDeploymentCandidateForUpdate,
  markQueuedDeploymentRunningWithExecutor,
  recordDeploymentMovementOrganizationClaim,
} from '../queries/deployment-claim.query';
import type { QueuedDeploymentClaimCandidateRow } from '../queries/deployment-claim.query.types';
import type { DeploymentRow, DeploymentTransaction } from '../queries/deployments.query.types';
import { updateOperationRecordWithExecutor } from '../queries/operations.query';
import { getApiDatabase } from '../runtime/runtime-access';
import { reserveDeploymentPublicRouteWithExecutor } from './deployment-route.service';
import type { DeploymentPublicRouteReservationContext } from './deployment-route.service.types';
import { buildClaimedDeploymentContext } from './deployment-worker-state.service';
import type { ClaimedDeploymentContext } from './deployments.service.types';

interface ClaimedDeploymentReservation {
  deploymentId: string;
}

export async function claimQueuedDeploymentForWorker(): Promise<ClaimedDeploymentContext | null> {
  const claimed: ClaimedDeploymentReservation | null = await claimQueuedDeploymentReservation();
  if (claimed === null) {
    return null;
  }

  return await buildClaimedDeploymentContext(claimed.deploymentId);
}

async function claimQueuedDeploymentReservation(): Promise<ClaimedDeploymentReservation | null> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<ClaimedDeploymentReservation | null> =>
      await claimQueuedDeploymentWithReservation(tx, new Date()),
  );
}

async function claimQueuedDeploymentWithReservation(
  tx: DeploymentTransaction,
  now: Date,
): Promise<ClaimedDeploymentReservation | null> {
  const candidate: QueuedDeploymentClaimCandidateRow | undefined =
    await findFirstFairQueuedDeploymentCandidateForUpdate(tx);
  if (candidate === undefined) {
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

  await markClaimedDeploymentOperationRunning(tx, candidate.organizationId, deployment.operationId, now);
  await reserveDeploymentPublicRouteWithExecutor(
    tx,
    buildDeploymentPublicRouteReservationContext(candidate, deployment.id, now),
  );

  return {
    deploymentId: deployment.id,
  };
}

async function markClaimedDeploymentOperationRunning(
  tx: DeploymentTransaction,
  organizationId: string,
  operationId: string,
  claimedAt: Date,
): Promise<void> {
  await recordDeploymentMovementOrganizationClaim(tx, organizationId, claimedAt);
  await updateOperationRecordWithExecutor(tx, {
    operationId,
    status: 'running',
  });
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
