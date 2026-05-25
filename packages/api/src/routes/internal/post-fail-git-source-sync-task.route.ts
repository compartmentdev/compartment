import {
  buildFastifyResponseSchemas,
  workerFailGitSourceSyncTaskPathname,
  workerFailGitSourceSyncTaskRequestSchema,
  type WorkerFailGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { failGitSourceSyncTaskForWorker } from '../../services/git-source/git-source-sync-worker.service';

export function registerPostFailGitSourceSyncTaskRoute(app: ApiApp): void {
  app.post(
    workerFailGitSourceSyncTaskPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerFailGitSourceSyncTaskRequestSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerFailGitSourceSyncTaskRequest = parseRequestValue(
        workerFailGitSourceSyncTaskRequestSchema,
        request.body,
        'invalid_worker_fail_git_source_sync_task_request',
      );
      await failGitSourceSyncTaskForWorker(input);
      return await reply.send(workerFailGitSourceSyncTaskRequestSchema.parse(input));
    },
  );
}
