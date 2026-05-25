import {
  buildFastifyResponseSchemas,
  nodeProjectCleanupPathname,
  nodeProjectCleanupRequestSchema,
  nodeProjectCleanupResponseSchema,
  type NodeProjectCleanupRequest,
  type NodeProjectCleanupResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import { cleanupRuntimeProject } from '../../services/runtime-project-cleanup.service';

export function registerPostProjectCleanupRoute(app: NodeApp, config: NodeConfig): void {
  app.post(
    nodeProjectCleanupPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeProjectCleanupResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: NodeProjectCleanupRequest = nodeProjectCleanupRequestSchema.parse(request.body);
      const response: NodeProjectCleanupResponse = nodeProjectCleanupResponseSchema.parse(
        await cleanupRuntimeProject(input, config),
      );

      return await reply.send(response);
    },
  );
}
