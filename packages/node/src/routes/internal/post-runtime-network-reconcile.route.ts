import {
  buildFastifyResponseSchemas,
  nodeRuntimeNetworkReconcilePathname,
  nodeRuntimeNetworkReconcileResponseSchema,
  type NodeRuntimeNetworkReconcileResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { reconcileRuntimeNetworks } from '../../services/runtime-network.service';

export function registerPostRuntimeNetworkReconcileRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeRuntimeNetworkReconcilePathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeRuntimeNetworkReconcileResponseSchema,
        }),
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      await reconcileRuntimeNetworks(config);
      const response: NodeRuntimeNetworkReconcileResponse = nodeRuntimeNetworkReconcileResponseSchema.parse({
        success: true,
      });

      return await reply.send(response);
    },
  );
}
