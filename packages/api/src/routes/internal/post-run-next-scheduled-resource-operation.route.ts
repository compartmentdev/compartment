import {
  buildFastifyResponseSchemas,
  type FastifyResponseSchemas,
  workerRunNextScheduledResourceOperationPathname,
  workerRunNextScheduledResourceOperationResponseSchema,
  type WorkerRunNextScheduledResourceOperationResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { runNextScheduledResourceOperationForWorker } from '../../services/resource-operation-scheduler.service';
import type { ScheduledResourceOperationResult } from '../../services/resource-operation-scheduler.service.types';
import { buildWorkerRunNextScheduledResourceOperationResponse } from './scheduled-resource-operation.presenter';

interface RunNextScheduledResourceOperationRouteOptions {
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerPostRunNextScheduledResourceOperationRoute(app: ApiApp): void {
  app.post(
    workerRunNextScheduledResourceOperationPathname,
    runNextScheduledResourceOperationRouteOptions,
    handlePostRunNextScheduledResourceOperation,
  );
}

const runNextScheduledResourceOperationRouteOptions: RunNextScheduledResourceOperationRouteOptions = {
  schema: {
    response: buildFastifyResponseSchemas({
      200: workerRunNextScheduledResourceOperationResponseSchema,
    }),
  },
};

async function handlePostRunNextScheduledResourceOperation(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const result: ScheduledResourceOperationResult = await runNextScheduledResourceOperationForWorker();
  const response: WorkerRunNextScheduledResourceOperationResponse =
    workerRunNextScheduledResourceOperationResponseSchema.parse(
      buildWorkerRunNextScheduledResourceOperationResponse(result),
    );

  return await reply.send(response);
}
