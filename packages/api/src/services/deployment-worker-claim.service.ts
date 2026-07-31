import { setTimeout as sleep } from 'node:timers/promises';
import {
  findFirstFairQueuedDeploymentCandidate,
  markQueuedDeploymentRunningWithExecutor,
  recordDeploymentMovementOrganizationClaim,
} from '../queries/deployment-claim.query';
import type { QueuedDeploymentClaimCandidateRow } from '../queries/deployment-claim.query.types';
import { lockActiveProjectDeploymentMutationWithExecutor } from '../queries/deployment-project-mutation.query';
import type { DeploymentProjectMutationStatus } from '../queries/deployment-project-mutation.query.types';
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

const skippedLockedProjectClaimAttempts: number = 5;
const skippedLockedProjectClaimRetryDelayMs: number = 10;

export async function claimQueuedDeploymentForWorker(): Promise<ClaimedDeploymentContext | null> {
  const claimed: ClaimedDeploymentReservation | null = await claimQueuedDeploymentReservation();
  if (claimed === null) {
    return null;
  }

  return await buildClaimedDeploymentContext(claimed.deploymentId);
}

async function claimQueuedDeploymentReservation(): Promise<ClaimedDeploymentReservation | null> {
  for (let attempt: number = 1; attempt <= skippedLockedProjectClaimAttempts; attempt += 1) {
    const reservation: ClaimedDeploymentReservation | null = await getApiDatabase().transaction(
      async (tx: DeploymentTransaction): Promise<ClaimedDeploymentReservation | null> =>
        await claimQueuedDeploymentWithReservation(tx, new Date()),
    );
    if (reservation !== null) {
      return reservation;
    }

    await waitForSkippedLockedProjectClaimRetry(attempt);
  }

  return null;
}

async function claimQueuedDeploymentWithReservation(
  tx: DeploymentTransaction,
  now: Date,
): Promise<ClaimedDeploymentReservation | null> {
  const candidate: QueuedDeploymentClaimCandidateRow | undefined = await findFirstFairQueuedDeploymentCandidate(tx);
  if (candidate === undefined) {
    return null;
  }

  return await reserveActiveProjectDeploymentRoute(tx, candidate, now);
}

async function waitForSkippedLockedProjectClaimRetry(attempt: number): Promise<void> {
  if (attempt >= skippedLockedProjectClaimAttempts) {
    return;
  }

  await sleep(skippedLockedProjectClaimRetryDelayMs);
}

async function reserveActiveProjectDeploymentRoute(
  tx: DeploymentTransaction,
  candidate: QueuedDeploymentClaimCandidateRow,
  now: Date,
): Promise<ClaimedDeploymentReservation | null> {
  const projectStatus: DeploymentProjectMutationStatus = await lockActiveProjectDeploymentMutationWithExecutor(
    tx,
    candidate.projectId,
  );
  if (projectStatus !== 'active') {
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
