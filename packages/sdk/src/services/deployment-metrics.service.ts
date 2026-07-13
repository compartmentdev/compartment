import {
  compartmentDeploymentMetricsPathname,
  deploymentMetricsSnapshotSchema,
  type DeploymentMetricsSnapshot,
  type DeploymentStatusQuery,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function getDeploymentMetrics(
  request: CompartmentRequester,
  query: DeploymentStatusQuery,
): Promise<DeploymentMetricsSnapshot> {
  return await request<DeploymentMetricsSnapshot, undefined>({
    method: 'GET',
    path: buildListPath(compartmentDeploymentMetricsPathname, [
      { name: 'projectName', value: query.projectName },
      { name: 'environmentName', value: query.environmentName },
      { name: 'deploymentId', value: query.deploymentId },
      { name: 'serviceName', value: query.serviceName },
    ]),
    schema: deploymentMetricsSnapshotSchema,
  });
}
