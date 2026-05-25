import {
  buildFastifyResponseSchemas,
  workerClaimGitSourceSyncTaskResponseSchema,
  workerClaimNextGitSourceSyncTaskPathname,
  type WorkerClaimGitSourceSyncTaskResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { claimGitSourceSyncTaskForWorker } from '../../services/git-source/git-source-sync-worker.service';

export function registerPostClaimGitSourceSyncTaskRoute(app: ApiApp): void {
  app.post(
    workerClaimNextGitSourceSyncTaskPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerClaimGitSourceSyncTaskResponseSchema,
        }),
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const response: WorkerClaimGitSourceSyncTaskResponse = workerClaimGitSourceSyncTaskResponseSchema.parse({
        task: await claimGitSourceSyncTaskForWorker(),
      });

      return await reply.send(response);
    },
  );
}
