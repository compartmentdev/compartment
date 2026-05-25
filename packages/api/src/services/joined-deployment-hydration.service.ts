import { findJoinedDeploymentById } from '../queries/deployment-joined.query';
import type { DeploymentJoinedRow, DeploymentRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { requireJoinedDeployment } from './deployment-context.service';

export async function hydrateJoinedDeploymentsById(deployments: DeploymentRow[]): Promise<DeploymentJoinedRow[]> {
  return await Promise.all(
    deployments.map(
      async (deployment: DeploymentRow): Promise<DeploymentJoinedRow> =>
        requireJoinedDeployment(await findJoinedDeploymentById(deployment.id, getApiConfig().baseDomain)),
    ),
  );
}
