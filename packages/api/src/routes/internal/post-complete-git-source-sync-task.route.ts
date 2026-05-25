import {
  buildFastifyResponseSchemas,
  workerCompleteGitSourceSyncTaskPathname,
  workerCompleteGitSourceSyncTaskRequestSchema,
  type WorkerCompleteGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { completeGitSourceSyncTaskForWorker } from '../../services/git-source/git-source-sync-worker.service';

export function registerPostCompleteGitSourceSyncTaskRoute(app: ApiApp): void {
  app.post(
    workerCompleteGitSourceSyncTaskPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerCompleteGitSourceSyncTaskRequestSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerCompleteGitSourceSyncTaskRequest = parseRequestValue(
        workerCompleteGitSourceSyncTaskRequestSchema,
        request.body,
        'invalid_worker_complete_git_source_sync_task_request',
      );
      await completeGitSourceSyncTaskForWorker(input);
      return await reply.send(workerCompleteGitSourceSyncTaskRequestSchema.parse(input));
    },
  );
}
