import {
  nodeTailLogsPathname,
  nodeTailLogsResponseSchema,
  type NodeTailLogsQuery,
  type NodeTailLogsResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';
import { buildListPath } from './list-path.service';

export async function tailNodeDeploymentLogs(
  request: NodeRequester,
  query: NodeTailLogsQuery,
): Promise<NodeTailLogsResponse> {
  return await request<NodeTailLogsResponse, undefined>({
    method: 'GET',
    path: buildNodeLogsPath(query),
    schema: nodeTailLogsResponseSchema,
  });
}

function buildNodeLogsPath(query: NodeTailLogsQuery): string {
  return buildListPath(nodeTailLogsPathname, [
    { name: 'containerId', value: query.containerId },
    { name: 'deploymentId', value: query.deploymentId },
    { name: 'environmentName', value: query.environmentName },
    { name: 'serviceName', value: query.serviceName },
    { name: 'since', value: query.since },
    { name: 'tailLines', value: query.tailLines },
  ]);
}
