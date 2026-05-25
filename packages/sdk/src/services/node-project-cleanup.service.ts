import {
  nodeProjectCleanupPathname,
  nodeProjectCleanupResponseSchema,
  type NodeProjectCleanupRequest,
  type NodeProjectCleanupResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';

export async function cleanupNodeProjectRuntime(
  request: NodeRequester,
  body: NodeProjectCleanupRequest,
): Promise<NodeProjectCleanupResponse> {
  return await request<NodeProjectCleanupResponse, NodeProjectCleanupRequest>({
    body,
    method: 'POST',
    path: nodeProjectCleanupPathname,
    schema: nodeProjectCleanupResponseSchema,
  });
}
