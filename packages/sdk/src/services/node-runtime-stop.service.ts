import {
  nodeStopDeploymentPathname,
  nodeStopDeploymentResponseSchema,
  type NodeStopDeploymentRequest,
  type NodeStopDeploymentResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';

export async function stopNodeDeployment(
  request: NodeRequester,
  body: NodeStopDeploymentRequest,
): Promise<NodeStopDeploymentResponse> {
  return await request<NodeStopDeploymentResponse, NodeStopDeploymentRequest>({
    body,
    method: 'POST',
    path: nodeStopDeploymentPathname,
    schema: nodeStopDeploymentResponseSchema,
  });
}
