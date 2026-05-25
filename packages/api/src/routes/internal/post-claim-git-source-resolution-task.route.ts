import {
  buildFastifyResponseSchemas,
  workerClaimGitSourceResolutionTaskResponseSchema,
  workerClaimNextGitSourceResolutionTaskPathname,
  type WorkerClaimGitSourceResolutionTaskResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { claimGitSourceResolutionTaskForWorker } from '../../services/git-source/git-source-resolution-worker.service';

export function registerPostClaimGitSourceResolutionTaskRoute(app: ApiApp): void {
  app.post(
    workerClaimNextGitSourceResolutionTaskPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerClaimGitSourceResolutionTaskResponseSchema,
        }),
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const response: WorkerClaimGitSourceResolutionTaskResponse =
        workerClaimGitSourceResolutionTaskResponseSchema.parse({
          task: await claimGitSourceResolutionTaskForWorker(),
        });

      return await reply.send(response);
    },
  );
}
