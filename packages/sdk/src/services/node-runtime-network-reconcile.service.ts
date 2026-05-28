import {
  nodeRuntimeNetworkReconcilePathname,
  nodeRuntimeNetworkReconcileResponseSchema,
  type NodeRuntimeNetworkReconcileResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';

export async function reconcileNodeRuntimeNetworks(
  request: NodeRequester,
): Promise<NodeRuntimeNetworkReconcileResponse> {
  return await request<NodeRuntimeNetworkReconcileResponse, never>({
    method: 'POST',
    path: nodeRuntimeNetworkReconcilePathname,
    schema: nodeRuntimeNetworkReconcileResponseSchema,
  });
}
