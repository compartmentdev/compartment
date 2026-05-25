import {
  buildFastifyResponseSchemas,
  type FastifyResponseSchemas,
  workerUploadGitSourceResolutionTaskArchiveResponseSchema,
  workerUploadGitSourceResolutionTaskArchivePathnameTemplate,
  type WorkerUploadGitSourceResolutionTaskArchiveResponse,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { storeSourceResolutionTaskArchive } from '../../services/git-source/source-resolution-task-archive-storage.service';

interface GitSourceResolutionTaskArchiveRouteParams {
  taskId: string;
}

interface UploadGitSourceResolutionTaskArchiveRouteOptions {
  bodyLimit: number;
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerPostUploadGitSourceResolutionTaskArchiveRoute(
  app: ApiApp,
  sourceArchiveMaxBytes: number,
): void {
  app.post(
    workerUploadGitSourceResolutionTaskArchivePathnameTemplate,
    readUploadGitSourceResolutionTaskArchiveRouteOptions(sourceArchiveMaxBytes),
    async (
      request: FastifyRequest<{ Params: GitSourceResolutionTaskArchiveRouteParams }>,
      reply: FastifyReply,
    ): Promise<FastifyReply> => {
      const taskId: string = requireTaskId(request.params.taskId);
      const sourceArchive: Buffer = requireSourceArchiveBuffer(request);
      await storeSourceResolutionTaskArchive(taskId, sourceArchive);

      const response: WorkerUploadGitSourceResolutionTaskArchiveResponse =
        workerUploadGitSourceResolutionTaskArchiveResponseSchema.parse({ success: true });
      return await reply.send(response);
    },
  );
}

function readUploadGitSourceResolutionTaskArchiveRouteOptions(
  sourceArchiveMaxBytes: number,
): UploadGitSourceResolutionTaskArchiveRouteOptions {
  return {
    bodyLimit: sourceArchiveMaxBytes,
    schema: {
      response: buildFastifyResponseSchemas({
        200: workerUploadGitSourceResolutionTaskArchiveResponseSchema,
      }),
    },
  };
}

function requireTaskId(taskId: string): string {
  if (!hasText(taskId)) {
    throw new ApiBoundaryError(
      400,
      'invalid_worker_git_source_resolution_task_id',
      'Source resolution task id is required.',
    );
  }

  return taskId;
}

function requireSourceArchiveBuffer(request: FastifyRequest): Buffer {
  if (Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (Buffer.isBuffer(request.rawBody)) {
    return request.rawBody;
  }

  throw new ApiBoundaryError(
    400,
    'invalid_worker_git_source_resolution_task_archive',
    'Source resolution task archive must be uploaded as application/gzip.',
  );
}
