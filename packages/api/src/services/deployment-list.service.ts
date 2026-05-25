import type { DeploymentJoinedRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { findProjectServiceByName } from '../queries/deployment-context.query';
import {
  listJoinedDeploymentsForEnvironment,
  listJoinedDeploymentsForService,
} from '../queries/deployment-joined.query';
import { getApiConfig } from '../runtime/runtime-access';
import { requireProjectService, resolveExistingEnvironmentContext } from './deployment-context.service';
import { resolveEnvironmentName } from './deployment-context.service.helpers';
import type { ResolvedEnvironmentContext } from './deployments.service.types';
import type { DeploymentListInput, DeploymentListResult } from './deployment-movement.service.types';

const defaultDeploymentListLimit: number = 20;

export async function listDeploymentsForPrincipal(input: DeploymentListInput): Promise<DeploymentListResult> {
  const environmentName: string = resolveEnvironmentName(input.environmentName);
  const limit: number = input.limit ?? defaultDeploymentListLimit;
  const environmentContext: ResolvedEnvironmentContext = await resolveExistingEnvironmentContext(
    input.principalId,
    input.organizationSlug,
    input.projectName,
    environmentName,
    'deployment.read',
  );

  return await buildDeploymentListResult(environmentContext, input.serviceName, limit);
}

async function buildDeploymentListResult(
  environmentContext: ResolvedEnvironmentContext,
  serviceName: string | undefined,
  limit: number,
): Promise<DeploymentListResult> {
  const service: ProjectServiceRow | undefined =
    serviceName !== undefined
      ? requireProjectService(await findProjectServiceByName(environmentContext.project.id, serviceName))
      : undefined;
  const routeBaseDomain: string = getApiConfig().baseDomain;
  const deployments: DeploymentJoinedRow[] =
    service !== undefined
      ? await listJoinedDeploymentsForService(environmentContext.environment.id, service.id, routeBaseDomain, limit)
      : limitEnvironmentDeploymentsByRun(
          await listJoinedDeploymentsForEnvironment(environmentContext.environment.id, routeBaseDomain),
          limit,
        );

  return {
    deployments,
    environment: environmentContext.environment,
    project: environmentContext.project,
  };
}

function limitEnvironmentDeploymentsByRun(
  deployments: readonly DeploymentJoinedRow[],
  limit: number,
): DeploymentJoinedRow[] {
  if (deployments.length === 0) {
    return [];
  }

  const includedRunIds: Set<string> = new Set<string>();
  const limitedDeployments: DeploymentJoinedRow[] = [];

  for (const deployment of deployments) {
    const deploymentRunId: string = deployment.deployment.deploymentRunId;
    if (!includedRunIds.has(deploymentRunId)) {
      if (includedRunIds.size === limit) {
        break;
      }

      includedRunIds.add(deploymentRunId);
    }

    limitedDeployments.push(deployment);
  }

  return limitedDeployments;
}
