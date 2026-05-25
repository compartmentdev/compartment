import {
  buildFastifyResponseSchemas,
  nodeDrainDeploymentPathname,
  nodeDrainDeploymentRequestSchema,
  nodeDrainDeploymentResponseSchema,
  type NodeDrainDeploymentRequest,
  type NodeDrainDeploymentResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { drainRuntimeContainer } from '../../services/runtime.service';

export function registerPostRuntimeDrainRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeDrainDeploymentPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeDrainDeploymentResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: NodeDrainDeploymentRequest = nodeDrainDeploymentRequestSchema.parse(request.body);
      const response: NodeDrainDeploymentResponse = nodeDrainDeploymentResponseSchema.parse(
        await drainRuntimeContainer(input, config),
      );

      return await reply.send(response);
    },
  );
}
