import {
  buildFastifyResponseSchemas,
  workerUpdateDeploymentRuntimePathname,
  workerUpdateDeploymentRuntimeRequestSchema,
  type WorkerUpdateDeploymentRuntimeRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { updateDeploymentRuntimeStateForWorker } from '../../services/deployment-runtime-state.service';

export function registerPostDeploymentRuntimeStateRoute(app: ApiApp): void {
  app.post(
    workerUpdateDeploymentRuntimePathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerUpdateDeploymentRuntimeRequestSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerUpdateDeploymentRuntimeRequest = parseRequestValue(
        workerUpdateDeploymentRuntimeRequestSchema,
        request.body,
        'invalid_worker_update_deployment_runtime_request',
      );
      await updateDeploymentRuntimeStateForWorker(input);
      const response: WorkerUpdateDeploymentRuntimeRequest = workerUpdateDeploymentRuntimeRequestSchema.parse(input);

      return await reply.send(response);
    },
  );
}
