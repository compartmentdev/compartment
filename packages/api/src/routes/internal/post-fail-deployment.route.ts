import {
  buildFastifyResponseSchemas,
  workerFailDeploymentPathname,
  workerFailDeploymentRequestSchema,
  type WorkerFailDeploymentRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { failQueuedDeployment } from '../../services/deployment-worker.service';

export function registerPostFailDeploymentRoute(app: ApiApp): void {
  app.post(
    workerFailDeploymentPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerFailDeploymentRequestSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerFailDeploymentRequest = parseRequestValue(
        workerFailDeploymentRequestSchema,
        request.body,
        'invalid_worker_fail_deployment_request',
      );
      await failQueuedDeployment(input);
      const response: WorkerFailDeploymentRequest = workerFailDeploymentRequestSchema.parse(input);

      return await reply.send(response);
    },
  );
}
