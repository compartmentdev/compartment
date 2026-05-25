import {
  nodeResourceDeletePathname,
  nodeResourceLogsPathname,
  nodeResourceDeleteRequestSchema,
  nodeResourceOperationBackupPathname,
  nodeResourceOperationRequestSchema,
  nodeResourceOperationRestorePathname,
  nodeResourceOperationResponseSchema,
  nodeResourceReconcilePathname,
  nodeResourceLogsQuerySchema,
  nodeResourceRequestSchema,
  nodeResourceRestartPolicyPathname,
  nodeResourceRestartPolicyRequestSchema,
  nodeResourceStartPathname,
  nodeResourceStopPathname,
  nodeResourceStopRequestSchema,
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
import type { FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { reconcileRuntimeResource, startRuntimeResource } from '../../services/runtime-resource.service';
import { deleteRuntimeResource, stopRuntimeResource } from '../../services/runtime-resource-lifecycle.service';
import { tailRuntimeResourceLogs } from '../../services/runtime-resource-logs.service';
import {
  runRuntimeResourceBackupOperation,
  runRuntimeResourceRestoreOperation,
} from '../../services/runtime-resource-operation.service';
import { updateRuntimeResourceRestartPolicy } from '../../services/runtime-resource-restart-policy.service';
import { parseNodeInternalRequestValue } from './node-internal-validation';

export function registerResourceRoutes(app: NodeApp, config: NodeConfig): void {
  registerResourceReconcileRoute(app, config);
  registerResourceStartRoute(app, config);
  registerResourceStopRoute(app, config);
  registerResourceDeleteRoute(app, config);
  registerResourceRestartPolicyRoute(app, config);
  registerResourceOperationRoutes(app, config);
  registerResourceLogsRoute(app);
}

function registerResourceReconcileRoute(app: NodeApp, config: NodeConfig): void {
  app.post(nodeResourceReconcilePathname, async (request: FastifyRequest): Promise<NodeResourceResponse> => {
    const input: NodeResourceRequest = nodeResourceRequestSchema.parse(request.body);
    return await reconcileRuntimeResource(input, config);
  });
}

function registerResourceStartRoute(app: NodeApp, config: NodeConfig): void {
  app.post(nodeResourceStartPathname, async (request: FastifyRequest): Promise<NodeResourceResponse> => {
    const input: NodeResourceRequest = nodeResourceRequestSchema.parse(request.body);
    return await startRuntimeResource(input, config);
  });
}

function registerResourceStopRoute(app: NodeApp, config: NodeConfig): void {
  app.post(nodeResourceStopPathname, async (request: FastifyRequest): Promise<NodeResourceResponse> => {
    const input: NodeResourceStopRequest = parseNodeInternalRequestValue(
      nodeResourceStopRequestSchema,
      request.body,
      'invalid_node_resource_stop_request',
    );
    return await stopRuntimeResource(input, config);
  });
}

function registerResourceDeleteRoute(app: NodeApp, config: NodeConfig): void {
  app.post(nodeResourceDeletePathname, async (request: FastifyRequest): Promise<NodeResourceResponse> => {
    const input: NodeResourceDeleteRequest = nodeResourceDeleteRequestSchema.parse(request.body);
    return await deleteRuntimeResource(input, config);
  });
}

function registerResourceRestartPolicyRoute(app: NodeApp, config: NodeConfig): void {
  app.post(nodeResourceRestartPolicyPathname, async (request: FastifyRequest): Promise<NodeResourceResponse> => {
    const input: NodeResourceRestartPolicyRequest = nodeResourceRestartPolicyRequestSchema.parse(request.body);
    return await updateRuntimeResourceRestartPolicy(input, config);
  });
}

function registerResourceLogsRoute(app: NodeApp): void {
  app.get(nodeResourceLogsPathname, async (request: FastifyRequest): Promise<NodeResourceLogsResponse> => {
    const input: NodeResourceLogsQuery = parseNodeInternalRequestValue(
      nodeResourceLogsQuerySchema,
      request.query,
      'invalid_node_resource_logs_query',
    );
    return await tailRuntimeResourceLogs(input);
  });
}

function registerResourceOperationRoutes(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeResourceOperationBackupPathname,
    async (request: FastifyRequest): Promise<NodeResourceOperationResponse> => {
      const input: NodeResourceOperationRequest = parseNodeInternalRequestValue(
        nodeResourceOperationRequestSchema,
        request.body,
        'invalid_node_resource_operation_request',
      );
      return nodeResourceOperationResponseSchema.parse(await runRuntimeResourceBackupOperation(input, config));
    },
  );
  app.post(
    nodeResourceOperationRestorePathname,
    async (request: FastifyRequest): Promise<NodeResourceOperationResponse> => {
      const input: NodeResourceOperationRequest = parseNodeInternalRequestValue(
        nodeResourceOperationRequestSchema,
        request.body,
        'invalid_node_resource_operation_request',
      );
      return nodeResourceOperationResponseSchema.parse(await runRuntimeResourceRestoreOperation(input, config));
    },
  );
}
