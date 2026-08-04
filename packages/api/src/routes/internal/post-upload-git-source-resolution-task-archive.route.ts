import {
  buildFastifyResponseSchemas,
  type FastifyResponseSchemas,
  workerUploadGitSourceResolutionTaskArchiveResponseSchema,
  workerUploadGitSourceResolutionTaskArchiveQuerySchema,
  workerUploadGitSourceResolutionTaskArchivePathnameTemplate,
  type WorkerUploadGitSourceResolutionTaskArchiveResponse,
  type WorkerUploadGitSourceResolutionTaskArchiveQuery,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import {
  SourceResolutionTaskArchiveDigestMismatchError,
  storeVerifiedSourceResolutionTaskArchive,
} from '../../services/git-source/source-resolution-task-archive-storage.service';
import { parseRequestValue } from '../../http/validation';

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
      request: FastifyRequest<{
        Params: GitSourceResolutionTaskArchiveRouteParams;
        Querystring: WorkerUploadGitSourceResolutionTaskArchiveQuery;
      }>,
      reply: FastifyReply,
    ): Promise<FastifyReply> => {
      await storeRequestSourceArchive(request);

      const response: WorkerUploadGitSourceResolutionTaskArchiveResponse =
        workerUploadGitSourceResolutionTaskArchiveResponseSchema.parse({ success: true });
      return await reply.send(response);
    },
  );
}

async function storeRequestSourceArchive(
  request: FastifyRequest<{
    Params: GitSourceResolutionTaskArchiveRouteParams;
    Querystring: WorkerUploadGitSourceResolutionTaskArchiveQuery;
  }>,
): Promise<void> {
  const query: WorkerUploadGitSourceResolutionTaskArchiveQuery = parseRequestValue(
    workerUploadGitSourceResolutionTaskArchiveQuerySchema,
    request.query,
    'invalid_worker_git_source_resolution_task_archive',
  );
  try {
    await storeVerifiedSourceResolutionTaskArchive(
      requireTaskId(request.params.taskId),
      requireSourceArchiveBuffer(request),
      query.sourceDigest,
    );
  } catch (error) {
    if (error instanceof SourceResolutionTaskArchiveDigestMismatchError) {
      throw new ApiBoundaryError(400, 'invalid_worker_git_source_resolution_task_archive', error.message);
    }
    throw error;
  }
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
