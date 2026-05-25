import {
  buildFastifyResponseSchemas,
  compartmentGitSourceExcludePathnameTemplate,
  compartmentGitSourceIncludePathnameTemplate,
  compartmentGitSourceSettingsPathnameTemplate,
  type FastifyResponseSchemas,
  gitSourceExclusionMutationResponseSchema,
  gitSourceSettingsResponseSchema,
  gitSourceSyncTaskResponseSchema,
  updateGitSourceExclusionRequestSchema,
  updateGitSourceSettingsRequestSchema,
  type GitSourceExclusionMutationResponse,
  type GitSourceSettingsResponse,
  type GitSourceSyncTaskResponse,
  type UpdateGitSourceExclusionRequest,
  type UpdateGitSourceSettingsRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { gitSourceInvalidParamsErrorCode, gitSourceInvalidRequestErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import { buildGitSourceSettingsAuditMetadata } from '../../services/audit-event-metadata.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { buildGitSourceAuditTarget } from '../../services/git-source/git-source-audit-target.service';
import {
  excludeGitSourceDescriptor,
  includeGitSourceDescriptor,
  readGitSourceSettings,
  updateGitSourceSettingsForSource,
} from '../../services/git-source/git-source-settings.service';
import type { GitSourceContextInput } from '../../services/git-source/git-source.service.types';
import {
  createCurrentOrganizationRouteOptions,
  type CurrentOrganizationRouteOptions,
} from '../protected/current-organization-route';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import type { RouteAuditEventInput } from '../audit/audit-event-route-context.types';
import {
  buildGitSourceDescriptorAuditEventInput,
  buildGitSourceSyncRequestedAuditEventInput,
  readGitSourceAuditDisplayName,
} from './source-git-audit-route';
import { buildGitSourceRouteContext } from './source-git-route-context';
import { gitSourceRouteParamsSchema, type GitSourceRouteParams } from './source-git.route.types';

const gitSourceSettingsReadRouteOptions: CurrentOrganizationRouteOptions =
  createCurrentOrganizationRouteOptions('source.read');
// No extra throttle is needed here because this stays on the same authenticated source-management surface as
// the existing connect, disconnect, and sync routes.
const gitSourceSettingsMutationRouteOptions: CurrentOrganizationRouteOptions =
  createCurrentOrganizationRouteOptions('source.manage');

interface GitSourceSettingsRouteOptions extends CurrentOrganizationRouteOptions {
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerGitSourceSettingsRoutes(app: ApiApp): void {
  registerGitSourceSettingsGetRoute(app);
  registerGitSourceSettingsPatchRoute(app);
  registerGitSourceExcludeRoute(app);
  registerGitSourceIncludeRoute(app);
}

async function handleGitSourceSettingsGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceRouteParams = parseRequestValue(
    gitSourceRouteParamsSchema,
    request.params,
    gitSourceInvalidParamsErrorCode,
  );
  const response: GitSourceSettingsResponse = gitSourceSettingsResponseSchema.parse({
    settings: await readGitSourceSettings({
      ...buildGitSourceRouteContext(request),
      sourceId: params.sourceId,
    }),
  });
  return await reply.send(response);
}

async function handleGitSourceSettingsPatch(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceRouteParams = readGitSourceRouteParams(request);
  const body: UpdateGitSourceSettingsRequest = parseRequestValue(
    updateGitSourceSettingsRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const routeContext: GitSourceContextInput = buildGitSourceRouteContext(request);
  const response: GitSourceSettingsResponse = gitSourceSettingsResponseSchema.parse({
    settings: await updateGitSourceSettingsForSource({
      ...routeContext,
      autoAdoptNewApps: body.autoAdoptNewApps,
      sourceId: params.sourceId,
    }),
  });
  const sourceDisplayName: string = await readGitSourceAuditDisplayName({ ...routeContext, sourceId: params.sourceId });
  await recordAuditEvent(
    buildAuditEventForRequest(
      request,
      buildGitSourceSettingsAuditEventInput(params.sourceId, sourceDisplayName, body.autoAdoptNewApps),
    ),
  );
  return await reply.send(response);
}

async function handleGitSourceExclude(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceRouteParams = readGitSourceRouteParams(request);
  const body: UpdateGitSourceExclusionRequest = readGitSourceExclusionRequest(request);
  await excludeGitSourceDescriptor({
    ...buildGitSourceRouteContext(request),
    descriptorPath: body.descriptorPath,
    sourceId: params.sourceId,
  });
  await recordAuditEvent(
    buildAuditEventForRequest(
      request,
      buildGitSourceDescriptorAuditEventInput(params.sourceId, body.descriptorPath, 'source.descriptor.excluded'),
    ),
  );
  return await reply.send(buildGitSourceExclusionMutationResponse(params.sourceId, body.descriptorPath));
}

async function handleGitSourceInclude(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceRouteParams = readGitSourceRouteParams(request);
  const body: UpdateGitSourceExclusionRequest = readGitSourceExclusionRequest(request);
  const routeContext: GitSourceContextInput = buildGitSourceRouteContext(request);
  const response: GitSourceSyncTaskResponse = gitSourceSyncTaskResponseSchema.parse({
    task: await includeGitSourceDescriptor({
      ...routeContext,
      descriptorPath: body.descriptorPath,
      sourceId: params.sourceId,
    }),
  });
  const sourceDisplayName: string = await readGitSourceAuditDisplayName({ ...routeContext, sourceId: params.sourceId });
  for (const auditEvent of buildGitSourceIncludeAuditEventInputs(params, body, response, sourceDisplayName)) {
    await recordAuditEvent(buildAuditEventForRequest(request, auditEvent));
  }
  return await reply.send(response);
}

function registerGitSourceSettingsGetRoute(app: ApiApp): void {
  app.get(compartmentGitSourceSettingsPathnameTemplate, gitSourceSettingsGetRouteOptions, handleGitSourceSettingsGet);
}

function registerGitSourceSettingsPatchRoute(app: ApiApp): void {
  app.patch(
    compartmentGitSourceSettingsPathnameTemplate,
    gitSourceSettingsPatchRouteOptions,
    handleGitSourceSettingsPatch,
  );
}

function registerGitSourceExcludeRoute(app: ApiApp): void {
  app.post(compartmentGitSourceExcludePathnameTemplate, gitSourceExcludeRouteOptions, handleGitSourceExclude);
}

function registerGitSourceIncludeRoute(app: ApiApp): void {
  app.post(compartmentGitSourceIncludePathnameTemplate, gitSourceIncludeRouteOptions, handleGitSourceInclude);
}

const gitSourceSettingsGetRouteOptions: GitSourceSettingsRouteOptions = {
  ...gitSourceSettingsReadRouteOptions,
  schema: {
    response: buildFastifyResponseSchemas({
      200: gitSourceSettingsResponseSchema,
    }),
  },
};

const gitSourceSettingsPatchRouteOptions: GitSourceSettingsRouteOptions = {
  ...gitSourceSettingsMutationRouteOptions,
  schema: {
    response: buildFastifyResponseSchemas({
      200: gitSourceSettingsResponseSchema,
    }),
  },
};

const gitSourceExcludeRouteOptions: GitSourceSettingsRouteOptions = {
  ...gitSourceSettingsMutationRouteOptions,
  schema: {
    response: buildFastifyResponseSchemas({
      200: gitSourceExclusionMutationResponseSchema,
    }),
  },
};

const gitSourceIncludeRouteOptions: GitSourceSettingsRouteOptions = {
  ...gitSourceSettingsMutationRouteOptions,
  schema: {
    response: buildFastifyResponseSchemas({
      200: gitSourceSyncTaskResponseSchema,
    }),
  },
};

function buildGitSourceSettingsAuditEventInput(
  sourceId: string,
  sourceDisplayName: string,
  autoAdoptNewApps: boolean,
): RouteAuditEventInput {
  return {
    eventType: 'source.settings.updated',
    metadata: buildGitSourceSettingsAuditMetadata({ autoAdoptNewApps }),
    target: buildGitSourceAuditTarget(sourceId, sourceDisplayName),
  };
}

function readGitSourceRouteParams(request: FastifyRequest): GitSourceRouteParams {
  return parseRequestValue(gitSourceRouteParamsSchema, request.params, gitSourceInvalidParamsErrorCode);
}

function readGitSourceExclusionRequest(request: FastifyRequest): UpdateGitSourceExclusionRequest {
  return parseRequestValue(updateGitSourceExclusionRequestSchema, request.body, gitSourceInvalidRequestErrorCode);
}

function buildGitSourceIncludeAuditEventInputs(
  params: GitSourceRouteParams,
  body: UpdateGitSourceExclusionRequest,
  response: GitSourceSyncTaskResponse,
  sourceDisplayName: string,
): RouteAuditEventInput[] {
  return [
    buildGitSourceDescriptorAuditEventInput(params.sourceId, body.descriptorPath, 'source.descriptor.included'),
    buildGitSourceSyncRequestedAuditEventInput({
      requestedBranchName: response.task.requestedBranchName,
      sourceDisplayName,
      sourceId: params.sourceId,
      taskId: response.task.id,
    }),
  ];
}

function buildGitSourceExclusionMutationResponse(
  sourceId: string,
  descriptorPath: string,
): GitSourceExclusionMutationResponse {
  return gitSourceExclusionMutationResponseSchema.parse({
    descriptorPath,
    sourceId,
    success: true,
  });
}
