import {
  buildFastifyResponseSchemas,
  nodeDeployPathname,
  nodeDeployRequestSchema,
  nodeDeployResponseSchema,
  type NodeDeployRequest,
  type NodeDeployResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { deployRuntimeContainer } from '../../services/runtime.service';

export function registerPostRuntimeDeployRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeDeployPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeDeployResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: NodeDeployRequest = nodeDeployRequestSchema.parse(request.body);
      const response: NodeDeployResponse = nodeDeployResponseSchema.parse(await deployRuntimeContainer(input, config));

      return await reply.send(response);
    },
  );
}
