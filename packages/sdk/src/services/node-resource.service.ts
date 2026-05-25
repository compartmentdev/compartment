import {
  nodeResourceDeletePathname,
  nodeResourceLogsPathname,
  nodeResourceLogsResponseSchema,
  nodeResourceOperationBackupPathname,
  nodeResourceOperationResponseSchema,
  nodeResourceOperationRestorePathname,
  nodeResourceReconcilePathname,
  nodeResourceResponseSchema,
  nodeResourceRestartPolicyPathname,
  nodeResourceStartPathname,
  nodeResourceStopPathname,
  type NodeResourceDeleteRequest,
  type NodeResourceLogsQuery,
  type NodeResourceLogsResponse,
  type NodeResourceOperationRequest,
  type NodeResourceOperationResponse,
  type NodeResourceRequest,
  type NodeResourceResponse,
  type NodeResourceRestartPolicyRequest,
  type NodeResourceStopRequest,
} from '@compartment/contracts';
import type { NodeRequester } from '../http/node-request.types';
import { buildListPath } from './list-path.service';

export async function reconcileNodeResource(
  request: NodeRequester,
  body: NodeResourceRequest,
): Promise<NodeResourceResponse> {
  return await request<NodeResourceResponse, NodeResourceRequest>({
    body,
    method: 'POST',
    path: nodeResourceReconcilePathname,
    schema: nodeResourceResponseSchema,
  });
}

export async function startNodeResource(
  request: NodeRequester,
  body: NodeResourceRequest,
): Promise<NodeResourceResponse> {
  return await request<NodeResourceResponse, NodeResourceRequest>({
    body,
    method: 'POST',
    path: nodeResourceStartPathname,
    schema: nodeResourceResponseSchema,
  });
}

export async function stopNodeResource(
  request: NodeRequester,
  body: NodeResourceStopRequest,
): Promise<NodeResourceResponse> {
  return await request<NodeResourceResponse, NodeResourceStopRequest>({
    body,
    method: 'POST',
    path: nodeResourceStopPathname,
    schema: nodeResourceResponseSchema,
  });
}

export async function deleteNodeResource(
  request: NodeRequester,
  body: NodeResourceDeleteRequest,
): Promise<NodeResourceResponse> {
  return await request<NodeResourceResponse, NodeResourceDeleteRequest>({
    body,
    method: 'POST',
    path: nodeResourceDeletePathname,
    schema: nodeResourceResponseSchema,
  });
}

export async function updateNodeResourceRestartPolicy(
  request: NodeRequester,
  body: NodeResourceRestartPolicyRequest,
): Promise<NodeResourceResponse> {
  return await request<NodeResourceResponse, NodeResourceRestartPolicyRequest>({
    body,
    method: 'POST',
    path: nodeResourceRestartPolicyPathname,
    schema: nodeResourceResponseSchema,
  });
}

export async function tailNodeResourceLogs(
  request: NodeRequester,
  query: NodeResourceLogsQuery,
): Promise<NodeResourceLogsResponse> {
  return await request<NodeResourceLogsResponse, undefined>({
    method: 'GET',
    path: buildNodeResourceLogsPath(query),
    schema: nodeResourceLogsResponseSchema,
  });
}

export async function runNodeResourceBackupOperation(
  request: NodeRequester,
  body: NodeResourceOperationRequest,
): Promise<NodeResourceOperationResponse> {
  return await request<NodeResourceOperationResponse, NodeResourceOperationRequest>({
    body,
    method: 'POST',
    path: nodeResourceOperationBackupPathname,
    schema: nodeResourceOperationResponseSchema,
  });
}

export async function runNodeResourceRestoreOperation(
  request: NodeRequester,
  body: NodeResourceOperationRequest,
): Promise<NodeResourceOperationResponse> {
  return await request<NodeResourceOperationResponse, NodeResourceOperationRequest>({
    body,
    method: 'POST',
    path: nodeResourceOperationRestorePathname,
    schema: nodeResourceOperationResponseSchema,
  });
}

function buildNodeResourceLogsPath(query: NodeResourceLogsQuery): string {
  return buildListPath(nodeResourceLogsPathname, [
    { name: 'containerId', value: query.containerId },
    { name: 'environmentName', value: query.environmentName },
    { name: 'resourceName', value: query.resourceName },
    { name: 'since', value: query.since },
    { name: 'tailLines', value: query.tailLines },
  ]);
}
