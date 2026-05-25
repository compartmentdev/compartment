import {
  buildFastifyResponseSchemas,
  workerFailGitSourceResolutionTaskRequestSchema,
  workerFailGitSourceResolutionTaskPathname,
  type WorkerFailGitSourceResolutionTaskRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { failGitSourceResolutionTaskForWorker } from '../../services/git-source/git-source-resolution-worker.service';

export function registerPostFailGitSourceResolutionTaskRoute(app: ApiApp): void {
  app.post(
    workerFailGitSourceResolutionTaskPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerFailGitSourceResolutionTaskRequestSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerFailGitSourceResolutionTaskRequest = parseRequestValue(
        workerFailGitSourceResolutionTaskRequestSchema,
        request.body,
        'invalid_worker_fail_git_source_resolution_task_request',
      );
      await failGitSourceResolutionTaskForWorker(input);
      return await reply.send(workerFailGitSourceResolutionTaskRequestSchema.parse(input));
    },
  );
}
