import { compartmentGitLabSourceWebhookPathnameTemplate } from '@compartment/contracts';
import { hasText, readHeaderValue } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { createGitSourceRequestInvalidError } from '../../errors/api-business-error';
import { gitSourceInvalidRequestErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import { handleGitLabSourceWebhook } from '../../services/git-source/git-source-runtime-gitlab.service';
import type { GitLabJsonObject } from '../../services/git-source/gitlab-http.adapter.types';
import { gitLabSourceWebhookRouteParamsSchema, type GitLabSourceWebhookRouteParams } from './source-git.route.types';
import { gitSourceWebhookRateLimitRouteOptions } from './source-git-public-rate-limit.route';

export function registerGitLabSourcePublicRoutes(app: ApiApp): void {
  app.post(
    compartmentGitLabSourceWebhookPathnameTemplate,
    gitSourceWebhookRateLimitRouteOptions,
    handleGitLabSourceWebhookRoute,
  );
}

async function handleGitLabSourceWebhookRoute(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitLabSourceWebhookRouteParams = parseRequestValue(
    gitLabSourceWebhookRouteParamsSchema,
    request.params,
    gitSourceInvalidRequestErrorCode,
  );
  await handleGitLabSourceWebhook({
    body: request.body as GitLabJsonObject,
    eventType: requireGitLabWebhookHeaderValue(request.headers['x-gitlab-event'], 'x-gitlab-event'),
    organizationId: params.organizationId,
    providerDeliveryId: requireGitLabWebhookHeaderValue(request.headers['x-gitlab-event-uuid'], 'x-gitlab-event-uuid'),
    registrationId: params.registrationId,
    token: requireGitLabWebhookHeaderValue(request.headers['x-gitlab-token'], 'x-gitlab-token'),
  });
  return await reply.code(202).send(null);
}

function requireGitLabWebhookHeaderValue(value: string | string[] | undefined, headerName: string): string {
  const headerValue: string | undefined = readHeaderValue(value);
  if (hasText(headerValue)) {
    return headerValue;
  }

  throw createGitSourceRequestInvalidError(`GitLab webhook header ${headerName} is required.`);
}
