import {
  compartmentGitHubProviderAccountDiscoveryPathname,
  compartmentGitHubProviderAccountDiscoveryResultPathname,
  gitHubAccountDiscoveryResultRequestSchema,
  gitHubAccountDiscoveryResultResponseSchema,
  gitHubAccountDiscoveryStartRequestSchema,
  gitHubAccountDiscoveryStartResponseSchema,
  type GitHubAccountDiscoveryResultRequest,
  type GitHubAccountDiscoveryResultResponse,
  type GitHubAccountDiscoveryStartRequest,
  type GitHubAccountDiscoveryStartResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { gitSourceInvalidRequestErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import {
  readGitHubAccountDiscoveryResult,
  startGitHubAccountDiscovery,
} from '../../services/git-source/github-account-discovery.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';

export function registerGitHubAccountDiscoveryRoutes(app: ApiApp): void {
  app.post(
    compartmentGitHubProviderAccountDiscoveryPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: gitHubAccountDiscoveryStartResponseSchema }),
    handleGitHubAccountDiscoveryStart,
  );
  app.post(
    compartmentGitHubProviderAccountDiscoveryResultPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', { 200: gitHubAccountDiscoveryResultResponseSchema }),
    handleGitHubAccountDiscoveryResult,
  );
}

async function handleGitHubAccountDiscoveryStart(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: GitHubAccountDiscoveryStartRequest = parseRequestValue(
    gitHubAccountDiscoveryStartRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const response: GitHubAccountDiscoveryStartResponse = gitHubAccountDiscoveryStartResponseSchema.parse(
    await startGitHubAccountDiscovery(body),
  );
  return await reply.send(response);
}

async function handleGitHubAccountDiscoveryResult(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: GitHubAccountDiscoveryResultRequest = parseRequestValue(
    gitHubAccountDiscoveryResultRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const response: GitHubAccountDiscoveryResultResponse = gitHubAccountDiscoveryResultResponseSchema.parse(
    await readGitHubAccountDiscoveryResult(body),
  );
  return await reply.send(response);
}
