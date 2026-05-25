import {
  buildFastifyResponseSchemas,
  type WorkerRecoverDeploymentsQuery,
  type WorkerRecoverDeploymentsResponse,
  workerRecoverDeploymentsPathname,
  workerRecoverDeploymentsQuerySchema,
  workerRecoverDeploymentsResponseSchema,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { recoverOrphanedRunningDeploymentsForWorker } from '../../services/deployment-worker.service';

export function registerPostRecoverRunningDeploymentsRoute(app: ApiApp): void {
  app.post(
    workerRecoverDeploymentsPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerRecoverDeploymentsResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const query: WorkerRecoverDeploymentsQuery = parseRequestValue(
        workerRecoverDeploymentsQuerySchema,
        request.query,
        'invalid_worker_recover_deployments_query',
        'The worker recovery query is invalid.',
      );
      const response: WorkerRecoverDeploymentsResponse = workerRecoverDeploymentsResponseSchema.parse(
        await recoverOrphanedRunningDeploymentsForWorker(query.mode ?? 'all'),
      );

      return await reply.send(response);
    },
  );
}
