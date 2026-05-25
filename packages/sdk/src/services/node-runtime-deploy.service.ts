import {
  nodeDeployPathname,
  nodeDeployResponseSchema,
  type NodeDeployRequest,
  type NodeDeployResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';

export async function deployToNode(request: NodeRequester, body: NodeDeployRequest): Promise<NodeDeployResponse> {
  return await request<NodeDeployResponse, NodeDeployRequest>({
    body,
    method: 'POST',
    path: nodeDeployPathname,
    schema: nodeDeployResponseSchema,
  });
}
