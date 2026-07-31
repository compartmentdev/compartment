import {
  compartmentGitLabProviderRegistrationsPathname,
  createGitLabProviderRegistrationRequestSchema,
  createGitProviderRegistrationResponseSchema,
  type CreateGitLabProviderRegistrationRequest,
  type CreateGitProviderRegistrationResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { gitSourceInvalidRequestErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import { createGitLabRegistration } from '../../services/git-source/gitlab-registration.service';
import type { GitLabRegistrationView } from '../../services/git-source/gitlab-registration.service.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';

export function registerGitLabSourceRoutes(app: ApiApp): void {
  // Token creation and repository enumeration are authenticated source.manage operations covered by
  // current-organization rate limiting. They are not Compartment login flows, so no additional
  // authentication cooldown applies to their outbound GitLab credential validation.
  app.post(
    compartmentGitLabProviderRegistrationsPathname,
    createCurrentOrganizationRouteResponseOptions('source.manage', {
      200: createGitProviderRegistrationResponseSchema,
    }),
    handleCreate,
  );
}

async function handleCreate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: CreateGitLabProviderRegistrationRequest = parseRequestValue(
    createGitLabProviderRegistrationRequestSchema,
    request.body,
    gitSourceInvalidRequestErrorCode,
  );
  const registration: GitLabRegistrationView = await createGitLabRegistration({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    request: body,
  });
  const response: CreateGitProviderRegistrationResponse = createGitProviderRegistrationResponseSchema.parse({
    registration,
  });
  return await reply.send(response);
}
