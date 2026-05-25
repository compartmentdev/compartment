import {
  buildFastifyResponseSchemas,
  workerCompleteDeploymentPathname,
  workerCompleteDeploymentResponseSchema,
  workerCompleteDeploymentRequestSchema,
  type WorkerCompleteDeploymentResponse,
  type WorkerCompleteDeploymentRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { completeQueuedDeployment } from '../../services/deployment-worker.service';

export function registerPostCompleteDeploymentRoute(app: ApiApp): void {
  app.post(
    workerCompleteDeploymentPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerCompleteDeploymentResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerCompleteDeploymentRequest = parseRequestValue(
        workerCompleteDeploymentRequestSchema,
        request.body,
        'invalid_worker_complete_deployment_request',
      );
      const response: WorkerCompleteDeploymentResponse = workerCompleteDeploymentResponseSchema.parse(
        await completeQueuedDeployment(input),
      );

      return await reply.send(response);
    },
  );
}
