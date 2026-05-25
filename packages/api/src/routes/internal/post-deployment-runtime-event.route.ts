import {
  buildFastifyResponseSchemas,
  workerAppendDeploymentEventPathname,
  workerAppendDeploymentEventRequestSchema,
  type WorkerAppendDeploymentEventRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { appendDeploymentRuntimeEventForWorker } from '../../services/deployment-runtime-state.service';

export function registerPostDeploymentRuntimeEventRoute(app: ApiApp): void {
  app.post(
    workerAppendDeploymentEventPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerAppendDeploymentEventRequestSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerAppendDeploymentEventRequest = parseRequestValue(
        workerAppendDeploymentEventRequestSchema,
        request.body,
        'invalid_worker_append_deployment_event_request',
      );
      await appendDeploymentRuntimeEventForWorker(input);
      const response: WorkerAppendDeploymentEventRequest = workerAppendDeploymentEventRequestSchema.parse(input);

      return await reply.send(response);
    },
  );
}
