import {
  buildFastifyResponseSchemas,
  nodeStopDeploymentPathname,
  nodeStopDeploymentRequestSchema,
  nodeStopDeploymentResponseSchema,
  type NodeStopDeploymentRequest,
  type NodeStopDeploymentResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { stopRuntimeContainer } from '../../services/runtime.service';
import { parseNodeInternalRequestValue } from './node-internal-validation';

export function registerPostRuntimeStopRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeStopDeploymentPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeStopDeploymentResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: NodeStopDeploymentRequest = parseNodeInternalRequestValue(
        nodeStopDeploymentRequestSchema,
        request.body,
        'invalid_node_stop_deployment_request',
      );
      const response: NodeStopDeploymentResponse = nodeStopDeploymentResponseSchema.parse(
        await stopRuntimeContainer(input, config),
      );

      return await reply.send(response);
    },
  );
}
