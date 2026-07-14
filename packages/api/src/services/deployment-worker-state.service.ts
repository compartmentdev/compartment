import type { RuntimeDrainState, WorkerRecoverDeploymentsMode } from '@compartment/contracts';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { hasDeploymentKubeReference } from '../queries/deployment-kube-membership.query';
import { findActiveJoinedDeployment, findJoinedDeploymentById } from '../queries/deployment-joined.query';
import { listOrphanedRunningDeployments, listPendingDrainDeployments } from '../queries/deployment-recovery.query';
import { findNodeById } from '../queries/node.query';
import { getApiConfig } from '../runtime/runtime-access';
import type {
  OrphanedRunningDeploymentRow,
  PendingDrainDeploymentRow,
} from '../queries/deployment-recovery.query.types';
import type { NodeRow } from '../queries/node.query.types';
import { requireJoinedDeployment, requireNode } from './deployment-context.service';
import { decryptResolvedBuildEnv } from './deployment-build.service';
import type { BuildEnvMap } from './deployment-build.types';
import { parseResolvedReadiness } from './deployment-readiness.service';
import { parseResolvedRelease } from './deployment-release.service';
import { parseResolvedRun } from './deployment-run.service';
import { resolveDeploymentPublicRoute } from './deployment-route.service';
import type { DeploymentPublicRoute } from './deployment-route.service.types';
import { buildDeploymentRuntimePlan, type DeploymentRuntimePlan } from './deployment-runtime-plan.service';
import type { ClaimedDeploymentContext, ClaimedPreviousDeploymentContext } from './deployments.service.types';

export async function listDeploymentsNeedingWorkerRecovery(mode: WorkerRecoverDeploymentsMode): Promise<string[]> {
  const pendingDrainDeployments: PendingDrainDeploymentRow[] = await listPendingDrainDeployments();
  const pendingDrainDeploymentIds: string[] = pendingDrainDeployments.map(
    (deployment: PendingDrainDeploymentRow): string => deployment.id,
  );
  if (mode === 'pending-drain') {
    return pendingDrainDeploymentIds;
  }

  const runningDeployments: OrphanedRunningDeploymentRow[] = await listOrphanedRunningDeployments();
  const runningDeploymentIds: string[] = runningDeployments.map(
    (deployment: OrphanedRunningDeploymentRow): string => deployment.id,
  );

  return [...new Set([...runningDeploymentIds, ...pendingDrainDeploymentIds])];
}

export async function buildClaimedDeploymentContext(deploymentId: string): Promise<ClaimedDeploymentContext> {
  const deployment: DeploymentJoinedRow = requireJoinedDeployment(
    await findJoinedDeploymentById(deploymentId, getApiConfig().baseDomain),
  );
  const node: NodeRow = requireNode(await findNodeById(deployment.deployment.nodeId));
  const previousDeployment: ClaimedPreviousDeploymentContext | null =
    await resolveClaimedPreviousDeployment(deployment);
  const buildEnv: BuildEnvMap = resolveClaimedBuildEnv(deployment);
  const runtimePlan: DeploymentRuntimePlan = await resolveClaimedRuntimePlan(deployment);
  const routeHost: string = await resolveClaimedRouteHost(deployment);

  return {
    buildEnv,
    deployment,
    node,
    previousDeployment,
    readiness: parseResolvedReadiness(deployment.deployment.resolvedReadinessJson),
    release: parseResolvedRelease(deployment.deployment.resolvedReleaseJson),
    run: parseResolvedRun(deployment.deployment.resolvedRunJson),
    routeHost,
    runtimeEnv: runtimePlan.runtimeEnv,
    runtimeNetwork: runtimePlan.runtimeNetwork,
  };
}

function resolveClaimedBuildEnv(deployment: DeploymentJoinedRow): BuildEnvMap {
  return decryptResolvedBuildEnv(deployment.artifact.resolvedBuildEnvJson);
}

async function resolveClaimedRuntimePlan(deployment: DeploymentJoinedRow): Promise<DeploymentRuntimePlan> {
  return await buildDeploymentRuntimePlan(
    deployment.environment.id,
    deployment.project.organizationId,
    deployment.service.id,
    deployment.environment.name,
    deployment.project.name,
    deployment.service.name,
  );
}

async function resolveClaimedRouteHost(deployment: DeploymentJoinedRow): Promise<string> {
  const publicRoute: DeploymentPublicRoute = await resolveDeploymentPublicRoute({
    deployment,
  });

  return publicRoute.routeHost;
}

export async function resolvePreviousActiveDeploymentForRecovery(
  deployment: DeploymentJoinedRow,
): Promise<DeploymentJoinedRow | null> {
  const activeDeployment: DeploymentJoinedRow | undefined = await findActiveJoinedDeployment(
    deployment.environment.id,
    deployment.service.id,
    getApiConfig().baseDomain,
  );
  if (activeDeployment === undefined || activeDeployment.deployment.id === deployment.deployment.id) {
    return null;
  }

  return activeDeployment;
}

export function isRunningDeploymentPendingCompletion(deployment: DeploymentJoinedRow): boolean {
  return (
    deployment.deployment.status === 'running' &&
    deployment.deployment.isActive === false &&
    deployment.deployment.completedAt === null
  );
}

export function isPendingDrainDeployment(deployment: DeploymentJoinedRow): boolean {
  return deployment.deployment.promotionStage === 'draining_previous' && readDeploymentDrainState(deployment) !== null;
}

export function readDeploymentDrainState(deployment: DeploymentJoinedRow): RuntimeDrainState | null {
  if (
    deployment.deployment.drainingContainerId === null ||
    deployment.deployment.drainingDeploymentId === null ||
    deployment.deployment.drainingNodeId === null
  ) {
    return null;
  }

  return {
    ...(deployment.deployment.drainDeadlineAt !== null
      ? { drainDeadlineAt: deployment.deployment.drainDeadlineAt.toISOString() }
      : {}),
    drainingContainerId: deployment.deployment.drainingContainerId,
    drainingDeploymentId: deployment.deployment.drainingDeploymentId,
    drainingNodeId: deployment.deployment.drainingNodeId,
  };
}

async function resolveClaimedPreviousDeployment(
  deployment: DeploymentJoinedRow,
): Promise<ClaimedPreviousDeploymentContext | null> {
  const previousDeployment: DeploymentJoinedRow | undefined = await findActiveJoinedDeployment(
    deployment.environment.id,
    deployment.service.id,
    getApiConfig().baseDomain,
  );
  if (previousDeployment === undefined || (await hasDeploymentKubeReference(previousDeployment.deployment.id))) {
    return null;
  }

  return {
    deployment: previousDeployment,
    node: requireNode(await findNodeById(previousDeployment.deployment.nodeId)),
  };
}
