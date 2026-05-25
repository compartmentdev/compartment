import type { WorkerCompleteDeploymentRequest } from '@compartment/contracts';
import { readPublicRouteSubdomain } from '../lib/public-route-host';
import { createId } from '../lib/tokens';
import { completeDeploymentWithRoute } from '../queries/deployment-completion.query';
import type { CompleteDeploymentWithRouteInput } from '../queries/deployment-completion.query.types';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import { planRollbackRetentionCleanup } from './deployment-retention.service';
import type { DeploymentPublicRoute } from './deployment-route.service.types';
import type { DeploymentArtifactCleanupTarget } from './deployment-retention.service.types';

type CompletionPromotionStage = 'active' | 'draining_previous';

export async function persistCompletedDeployment(
  deployment: DeploymentJoinedRow,
  input: WorkerCompleteDeploymentRequest,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const now: Date = new Date();
  const publicRoute: DeploymentPublicRoute = requireRuntimeDeploymentPublicRoute(input.routeHost);
  const completionInput: CompleteDeploymentWithRouteInput = buildCompletionRouteInput(
    deployment,
    input,
    publicRoute,
    now,
  );

  await completeDeploymentWithRoute(completionInput);
  const edgeSyncError: Error | null = await synchronizeEdgeAppAccessStateSafely();
  if (edgeSyncError !== null) {
    throw edgeSyncError;
  }

  return await planRollbackRetentionCleanup(deployment);
}

function requireRuntimeDeploymentPublicRoute(routeHost: string): DeploymentPublicRoute {
  const baseDomain: string = getApiConfig().baseDomain;
  const routeSubdomain: string | null = readPublicRouteSubdomain(routeHost, baseDomain);
  if (routeSubdomain === null) {
    throw new Error(`Expected route host ${routeHost} to belong to ${baseDomain}.`);
  }

  return {
    routeHost,
    routeSubdomain,
  };
}

function buildCompletionRouteInput(
  deployment: DeploymentJoinedRow,
  input: WorkerCompleteDeploymentRequest,
  publicRoute: DeploymentPublicRoute,
  now: Date,
): CompleteDeploymentWithRouteInput {
  return {
    accessScopeId: deployment.environment.id,
    accessScopeType: 'environment',
    completedAt: now,
    containerId: input.containerId,
    deploymentId: input.deploymentId,
    ...buildDrainFields(input),
    environmentId: deployment.environment.id,
    imageRef: input.imageRef,
    operationId: deployment.operation.id,
    promotionStage: resolveCompletionPromotionStage(input),
    buildArtifactId: deployment.artifact.id,
    ...buildCompletionRouteFields(publicRoute, input),
    serviceId: deployment.service.id,
    updatedAt: now,
  };
}

function buildCompletionRouteFields(
  publicRoute: DeploymentPublicRoute,
  input: WorkerCompleteDeploymentRequest,
): Pick<
  CompleteDeploymentWithRouteInput,
  'routeHost' | 'routeId' | 'upstreamHost' | 'upstreamPort' | 'routeSubdomain'
> {
  return {
    routeHost: publicRoute.routeHost,
    routeId: createId('rte'),
    upstreamHost: input.upstreamHost,
    upstreamPort: input.upstreamPort,
    routeSubdomain: publicRoute.routeSubdomain,
  };
}

function buildDrainFields(
  input: WorkerCompleteDeploymentRequest,
): Pick<
  CompleteDeploymentWithRouteInput,
  'drainDeadlineAt' | 'drainingContainerId' | 'drainingDeploymentId' | 'drainingNodeId'
> {
  if (input.drain === undefined) {
    return {
      drainDeadlineAt: null,
      drainingContainerId: null,
      drainingDeploymentId: null,
      drainingNodeId: null,
    };
  }

  return {
    drainDeadlineAt: input.drain.drainDeadlineAt !== undefined ? new Date(input.drain.drainDeadlineAt) : null,
    drainingContainerId: input.drain.drainingContainerId,
    drainingDeploymentId: input.drain.drainingDeploymentId,
    drainingNodeId: input.drain.drainingNodeId,
  };
}

function resolveCompletionPromotionStage(input: WorkerCompleteDeploymentRequest): CompletionPromotionStage {
  return input.drain !== undefined ? 'draining_previous' : 'active';
}

async function synchronizeEdgeAppAccessStateSafely(): Promise<Error | null> {
  try {
    await synchronizeEdgeAppAccessState();

    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error('Failed to synchronize edge app access state.');
  }
}
