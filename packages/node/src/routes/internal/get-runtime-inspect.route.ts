import {
  buildFastifyResponseSchemas,
  nodeInspectDeploymentPathname,
  nodeInspectDeploymentQuerySchema,
  nodeInspectDeploymentResponseSchema,
  type NodeInspectDeploymentQuery,
  type NodeInspectDeploymentResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { inspectRuntimeDeployment } from '../../services/runtime.service';
import { parseNodeInternalRequestValue } from './node-internal-validation';

export function registerGetRuntimeInspectRoute(app: NodeApp, config: NodeConfig): void {
  app.get(
    nodeInspectDeploymentPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeInspectDeploymentResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const query: NodeInspectDeploymentQuery = parseNodeInternalRequestValue(
        nodeInspectDeploymentQuerySchema,
        request.query,
        'invalid_node_inspect_deployment_query',
      );
      const response: NodeInspectDeploymentResponse = nodeInspectDeploymentResponseSchema.parse(
        await inspectRuntimeDeployment(query, config),
      );

      return await reply.send(response);
    },
  );
}
