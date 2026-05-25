import {
  compartmentGitHubProviderBootstrapPathname,
  compartmentGitSourceConnectPathname,
  compartmentSourcesPathname,
  connectGitSourceRequestSchema,
  disconnectGitSourceResponseSchema,
  gitHubProviderBootstrapRequestSchema,
  gitHubProviderBootstrapResponseSchema,
  gitSourceListResponseSchema,
  gitSourceResponseSchema,
  type ConnectGitSourceRequest,
  type DisconnectGitSourceResponse,
  type GitHubProviderBootstrapRequest,
  type GitHubProviderBootstrapResponse,
  type GitSourceListResponse,
  type GitSourceResponse,
  type GitSourceSummary,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import {
  gitSourceBootstrapInvalidErrorCode,
  gitSourceInvalidParamsErrorCode,
  gitSourceInvalidRequestErrorCode,
} from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import { getApiConfig } from '../../runtime/runtime-access';
import {
  connectGitSource,
  disconnectGitSource,
  listGitSources,
  readGitSource,
} from '../../services/git-source/git-source.service';
import type {
  ConnectGitSourceResult,
  GitSourceListItem,
  GitSourceView,
} from '../../services/git-source/git-source.service.types';
import {
  readGitHubProviderBootstrapStatus,
  startGitHubProviderBootstrap,
} from '../../services/git-source/git-source-bootstrap.service';
import { buildRuntimePublicSettings } from '../../services/public-hosts.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildGitSourceRouteContext } from './source-git-route-context';
import {
  gitHubBootstrapStateRouteParamsSchema,
  gitSourceRouteParamsSchema,
  type GitHubBootstrapStateRouteParams,
  type GitSourceRouteParams,
} from './source-git.route.types';
import { registerGitHubAccountDiscoveryRoutes } from './source-git-account-discovery.route';
import { emitGitSourceConnectResultAuditEvents, emitGitSourceDisconnectAuditEvent } from './source-git-audit-route';
import { registerGitSourceDescriptorRoutes } from './source-git-descriptor.route';
import { registerGitSourceSyncRoutes } from './source-git-sync.route';
import { registerGitSourceSettingsRoutes } from './source-git-settings.route';

export function registerGitSourceRoutes(app: ApiApp): void {
  registerGitSourceReadRoutes(app);
  registerGitSourceWriteRoutes(app);
  registerGitSourceDescriptorRoutes(app);
  registerGitSourceSettingsRoutes(app);
  registerGitSourceSyncRoutes(app);
}

async function handleGitSourceList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: GitSourceListResponse = gitSourceListResponseSchema.parse({
    sources: (await listGitSources(buildGitSourceRouteContext(request))).map(
      (item: GitSourceListItem): GitSourceSummary => item.source,
    ),
  });
  return await reply.send(response);
}

async function handleGitSourceShow(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceRouteParams = parseRequestValue(
    gitSourceRouteParamsSchema,
    request.params,
    gitSourceInvalidParamsErrorCode,
  );
  const response: GitSourceResponse = gitSourceResponseSchema.parse(
    buildGitSourceResponse(
      await readGitSource({
        ...buildGitSourceRouteContext(request),
        sourceId: params.sourceId,
      }),
    ),
  );
  return await reply.send(response);
}

async function handleGitSourceDisconnect(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitSourceRouteParams = parseRequestValue(
    gitSourceRouteParamsSchema,
    request.params,
    gitSourceInvalidParamsErrorCode,
  );
  const view: GitSourceView = await disconnectGitSource({
    ...buildGitSourceRouteContext(request),
    sourceId: params.sourceId,
  });
  await emitGitSourceDisconnectAuditEvent(request, view);
  const response: DisconnectGitSourceResponse = disconnectGitSourceResponseSchema.parse({
    sourceId: params.sourceId,
    success: true,
  });
  return await reply.send(response);
}

async function handleGitHubProviderBootstrapStart(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: GitHubProviderBootstrapRequest = parseRequestValue(
    gitHubProviderBootstrapRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const response: GitHubProviderBootstrapResponse = gitHubProviderBootstrapResponseSchema.parse(
    await startGitHubProviderBootstrap({
      actor: request.actor,
      compartmentUrl: buildRuntimePublicSettings(getApiConfig()).compartmentUrl,
      organizationId: request.currentOrganization.id,
      providerHost: body.providerHost,
      repositoryOwner: body.repositoryOwner,
      returnTo: body.returnTo,
    }),
  );
  return await reply.send(response);
}

async function handleGitHubProviderBootstrapStatus(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const params: GitHubBootstrapStateRouteParams = parseRequestValue(
    gitHubBootstrapStateRouteParamsSchema,
    request.params,
    gitSourceBootstrapInvalidErrorCode,
  );
  const response: GitHubProviderBootstrapResponse = gitHubProviderBootstrapResponseSchema.parse(
    await readGitHubProviderBootstrapStatus({
      actor: request.actor,
      bootstrapStateId: params.bootstrapStateId,
      organizationId: request.currentOrganization.id,
    }),
  );
  return await reply.send(response);
}

async function handleGitSourceConnect(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: ConnectGitSourceRequest = parseRequestValue(
    connectGitSourceRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const result: ConnectGitSourceResult = await connectGitSource({
    ...buildGitSourceRouteContext(request),
    request: body,
  });
  await emitGitSourceConnectResultAuditEvents(request, result);
  const response: GitSourceResponse = gitSourceResponseSchema.parse(buildGitSourceResponse(result.view));
  return await reply.send(response);
}

function buildGitSourceResponse(view: GitSourceView): GitSourceResponse {
  return {
    source: {
      ...view.source,
      bindings: view.bindings,
    },
  };
}

function registerGitSourceReadRoutes(app: ApiApp): void {
  app.get(
    compartmentSourcesPathname,
    createCurrentOrganizationRouteResponseOptions('source.read', { 200: gitSourceListResponseSchema }),
    handleGitSourceList,
  );
  app.get(
    `${compartmentSourcesPathname}/:sourceId`,
    createCurrentOrganizationRouteResponseOptions('source.read', { 200: gitSourceResponseSchema }),
    handleGitSourceShow,
  );
  app.get(
    `${compartmentGitHubProviderBootstrapPathname}/:bootstrapStateId`,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: gitHubProviderBootstrapResponseSchema }),
    handleGitHubProviderBootstrapStatus,
  );
}

function registerGitSourceWriteRoutes(app: ApiApp): void {
  app.delete(
    `${compartmentSourcesPathname}/:sourceId`,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: disconnectGitSourceResponseSchema }),
    handleGitSourceDisconnect,
  );
  registerGitHubAccountDiscoveryRoutes(app);
  app.post(
    compartmentGitHubProviderBootstrapPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: gitHubProviderBootstrapResponseSchema }),
    handleGitHubProviderBootstrapStart,
  );
  app.post(
    compartmentGitSourceConnectPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: gitSourceResponseSchema }),
    handleGitSourceConnect,
  );
}
