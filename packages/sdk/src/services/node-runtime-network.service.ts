import {
  nodeRuntimeNetworkReservationCleanupPathname,
  nodeRuntimeNetworkReservationCleanupResponseSchema,
  nodeRuntimeNetworkReservationPathname,
  nodeRuntimeNetworkReservationResponseSchema,
  type NodeRuntimeNetworkReservationCleanupRequest,
  type NodeRuntimeNetworkReservationCleanupResponse,
  type NodeRuntimeNetworkReservationRequest,
  type NodeRuntimeNetworkReservationResponse,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';

export async function reserveNodeRuntimeNetworks(
  request: NodeRequester,
  body: NodeRuntimeNetworkReservationRequest,
): Promise<NodeRuntimeNetworkReservationResponse> {
  return await request<NodeRuntimeNetworkReservationResponse, NodeRuntimeNetworkReservationRequest>({
    body,
    method: 'POST',
    path: nodeRuntimeNetworkReservationPathname,
    schema: nodeRuntimeNetworkReservationResponseSchema,
  });
}

export async function cleanupNodeRuntimeNetworkReservation(
  request: NodeRequester,
  body: NodeRuntimeNetworkReservationCleanupRequest,
): Promise<NodeRuntimeNetworkReservationCleanupResponse> {
  return await request<NodeRuntimeNetworkReservationCleanupResponse, NodeRuntimeNetworkReservationCleanupRequest>({
    body,
    method: 'POST',
    path: nodeRuntimeNetworkReservationCleanupPathname,
    schema: nodeRuntimeNetworkReservationCleanupResponseSchema,
  });
}
