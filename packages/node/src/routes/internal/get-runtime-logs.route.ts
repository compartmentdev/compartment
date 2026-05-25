import {
  buildFastifyResponseSchemas,
  nodeTailLogsPathname,
  nodeTailLogsQuerySchema,
  nodeTailLogsResponseSchema,
  type NodeTailLogsQuery,
  type NodeTailLogsResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NodeApp } from '../../app.types';
import { tailRuntimeContainerLogs } from '../../services/runtime.service';
import { parseNodeInternalRequestValue } from './node-internal-validation';

export function registerGetRuntimeLogsRoute(app: NodeApp): void {
  app.get(
    nodeTailLogsPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: nodeTailLogsResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const query: NodeTailLogsQuery = parseNodeInternalRequestValue(
        nodeTailLogsQuerySchema,
        request.query,
        'invalid_node_tail_logs_query',
      );
      const response: NodeTailLogsResponse = nodeTailLogsResponseSchema.parse(await tailRuntimeContainerLogs(query));

      return await reply.send(response);
    },
  );
}
