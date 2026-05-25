import {
  buildNodeInspectReadinessFields,
  nodeInspectDeploymentPathname,
  nodeInspectDeploymentQuerySchema,
  nodeInspectDeploymentResponseSchema,
  readNodeInspectReadiness,
  type NodeInspectDeploymentReadinessFields,
  type NodeInspectDeploymentQuery,
  type NodeInspectDeploymentResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';
import { buildListPath } from './list-path.service';

export async function inspectNodeDeployment(
  request: NodeRequester,
  query: NodeInspectDeploymentQuery,
): Promise<NodeInspectDeploymentResponse> {
  return await request<NodeInspectDeploymentResponse, undefined>({
    method: 'GET',
    path: buildNodeInspectPath(query),
    schema: nodeInspectDeploymentResponseSchema,
  });
}

function buildNodeInspectPath(query: NodeInspectDeploymentQuery): string {
  const parsedQuery: NodeInspectDeploymentQuery = nodeInspectDeploymentQuerySchema.parse(query);
  const readinessFields: NodeInspectDeploymentReadinessFields = buildNodeInspectReadinessFields(
    readNodeInspectReadiness(parsedQuery) ?? undefined,
  );
  return buildListPath(nodeInspectDeploymentPathname, [
    { name: 'deploymentId', value: parsedQuery.deploymentId },
    { name: 'environmentName', value: parsedQuery.environmentName },
    { name: 'projectName', value: parsedQuery.projectName },
    { name: 'serviceName', value: parsedQuery.serviceName },
    { name: 'readinessPath', value: readinessFields.readinessPath },
    { name: 'readinessTimeoutMs', value: readinessFields.readinessTimeoutMs },
    { name: 'readinessType', value: readinessFields.readinessType },
  ]);
}
