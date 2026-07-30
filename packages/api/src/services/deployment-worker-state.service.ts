import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { findJoinedDeploymentById } from '../queries/deployment-joined.query';
import { getApiConfig } from '../runtime/runtime-access';
import { requireJoinedDeployment } from './deployment-context.service';
import { parseResolvedBuildEnv } from './deployment-build.service';
import { parseResolvedRun } from './deployment-run.service';
import { resolveDeploymentPublicRoute } from './deployment-route.service';
import type { DeploymentPublicRoute } from './deployment-route.service.types';
import type { ClaimedDeploymentContext } from './deployments.service.types';

export async function buildClaimedDeploymentContext(deploymentId: string): Promise<ClaimedDeploymentContext> {
  const deployment: DeploymentJoinedRow = requireJoinedDeployment(
    await findJoinedDeploymentById(deploymentId, getApiConfig().baseDomain),
  );
  const publicRoute: DeploymentPublicRoute = await resolveDeploymentPublicRoute({ deployment });

  return {
    buildEnv: parseResolvedBuildEnv(deployment.artifact.resolvedBuildEnvJson),
    deployment,
    routeHost: publicRoute.routeHost,
    run: parseResolvedRun(deployment.deployment.resolvedRunJson),
  };
}
