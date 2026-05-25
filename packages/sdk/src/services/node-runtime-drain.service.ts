import {
  nodeDrainDeploymentPathname,
  nodeDrainDeploymentResponseSchema,
  type NodeDrainDeploymentRequest,
  type NodeDrainDeploymentResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';

export async function drainNodeDeployment(
  request: NodeRequester,
  body: NodeDrainDeploymentRequest,
): Promise<NodeDrainDeploymentResponse> {
  return await request<NodeDrainDeploymentResponse, NodeDrainDeploymentRequest>({
    body,
    method: 'POST',
    path: nodeDrainDeploymentPathname,
    schema: nodeDrainDeploymentResponseSchema,
  });
}
