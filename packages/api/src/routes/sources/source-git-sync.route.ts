import {
  compartmentGitSourceSyncPathnameTemplate,
  compartmentGitSourceSyncTaskPathnameTemplate,
  gitSourceSyncTaskResponseSchema,
  type GitSourceSyncTaskResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { gitSourceInvalidParamsErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import { recordAuditEvent } from '../../services/audit-events.service';
import { readGitSourceSyncTask, startGitSourceSync } from '../../services/git-source/git-source-sync.service';
import type { GitSourceSyncTaskView } from '../../services/git-source/git-source-sync.service.types';
import type { GitSourceContextInput } from '../../services/git-source/git-source.service.types';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildGitSourceSyncRequestedAuditEventInput, readGitSourceAuditDisplayName } from './source-git-audit-route';
import { buildGitSourceRouteContext } from './source-git-route-context';
import {
  gitSourceRouteParamsSchema,
  gitSourceSyncTaskRouteParamsSchema,
  type GitSourceRouteParams,
  type GitSourceSyncTaskRouteParams,
} from './source-git.route.types';

export function registerGitSourceSyncRoutes(app: ApiApp): void {
  app.post(
    compartmentGitSourceSyncPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: gitSourceSyncTaskResponseSchema }),
    handleGitSourceSyncStart,
  );
  app.get(
    compartmentGitSourceSyncTaskPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions('source.read', { 200: gitSourceSyncTaskResponseSchema }),
    handleGitSourceSyncTask,
  );
}

async function handleGitSourceSyncStart(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceRouteParams = readGitSourceRouteParams(request);
  const routeContext: GitSourceContextInput = buildGitSourceRouteContext(request);
  const task: GitSourceSyncTaskView = await startGitSourceSync({
    ...routeContext,
    sourceId: params.sourceId,
  });
  const sourceDisplayName: string = await readGitSourceAuditDisplayName({ ...routeContext, sourceId: params.sourceId });
  await recordAuditEvent(
    buildAuditEventForRequest(
      request,
      buildGitSourceSyncRequestedAuditEventInput({
        requestedBranchName: task.requestedBranchName,
        sourceDisplayName,
        sourceId: params.sourceId,
        taskId: task.id,
      }),
    ),
  );
  const response: GitSourceSyncTaskResponse = gitSourceSyncTaskResponseSchema.parse({
    task,
  });
  return await reply.send(response);
}

function readGitSourceRouteParams(request: FastifyRequest): GitSourceRouteParams {
  return parseRequestValue(gitSourceRouteParamsSchema, request.params, gitSourceInvalidParamsErrorCode);
}

async function handleGitSourceSyncTask(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceSyncTaskRouteParams = parseRequestValue(
    gitSourceSyncTaskRouteParamsSchema,
    request.params,
    gitSourceInvalidParamsErrorCode,
  );
  const response: GitSourceSyncTaskResponse = gitSourceSyncTaskResponseSchema.parse({
    task: await readGitSourceSyncTask({
      ...buildGitSourceRouteContext(request),
      sourceId: params.sourceId,
      taskId: params.taskId,
    }),
  });
  return await reply.send(response);
}
