import {
  buildFastifyResponseSchemas,
  workerCompleteGitSourceResolutionTaskRequestSchema,
  workerCompleteGitSourceResolutionTaskPathname,
  type WorkerCompleteGitSourceResolutionTaskRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { completeGitSourceResolutionTaskForWorker } from '../../services/git-source/git-source-resolution-worker.service';

export function registerPostCompleteGitSourceResolutionTaskRoute(app: ApiApp): void {
  app.post(
    workerCompleteGitSourceResolutionTaskPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: workerCompleteGitSourceResolutionTaskRequestSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerCompleteGitSourceResolutionTaskRequest = parseRequestValue(
        workerCompleteGitSourceResolutionTaskRequestSchema,
        request.body,
        'invalid_worker_complete_git_source_resolution_task_request',
      );
      await completeGitSourceResolutionTaskForWorker(input);
      return await reply.send(workerCompleteGitSourceResolutionTaskRequestSchema.parse(input));
    },
  );
}
