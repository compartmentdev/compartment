import {
  nodeReleasePathname,
  nodeReleaseResponseSchema,
  type NodeReleaseRequest,
  type NodeReleaseResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';

export async function releaseNodeDeployment(
  request: NodeRequester,
  body: NodeReleaseRequest,
): Promise<NodeReleaseResponse> {
  return await request<NodeReleaseResponse, NodeReleaseRequest>({
    body,
    method: 'POST',
    path: nodeReleasePathname,
    schema: nodeReleaseResponseSchema,
  });
}
