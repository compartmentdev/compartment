import {
  compartmentFirstDeployOnboardingPathname,
  compartmentFirstDeployOnboardingSessionPathnameTemplate,
  compartmentFirstDeployOnboardingStatusPathnameTemplate,
  createFirstDeployOnboardingSessionRequestSchema,
  firstDeployOnboardingSessionResponseSchema,
  firstDeployOnboardingStatusResponseSchema,
  patchFirstDeployOnboardingSessionRequestSchema,
  type CreateFirstDeployOnboardingSessionRequest,
  type FirstDeployOnboardingSessionResponse,
  type FirstDeployOnboardingStatusResponse,
  type PatchFirstDeployOnboardingSessionRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import {
  createFirstDeployOnboarding,
  patchFirstDeployOnboarding,
  readFirstDeployOnboarding,
  readFirstDeployOnboardingStatus,
} from '../../services/onboarding-first-deploy.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import {
  firstDeployOnboardingSessionRouteParamsSchema,
  type FirstDeployOnboardingSessionRouteParams,
} from './onboarding-first-deploy.route.types';

const invalidFirstDeployOnboardingRequestCode: string = 'invalid_first_deploy_onboarding_request';
const invalidFirstDeployOnboardingParamsCode: string = 'invalid_first_deploy_onboarding_params';

export function registerFirstDeployOnboardingRoutes(app: ApiApp): void {
  // Abuse protection: current-organization auth is required and no auth tokens or login codes are accepted here.
  app.post(
    compartmentFirstDeployOnboardingPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: firstDeployOnboardingSessionResponseSchema }),
    handleCreateFirstDeployOnboarding,
  );
  app.get(
    compartmentFirstDeployOnboardingSessionPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: firstDeployOnboardingSessionResponseSchema }),
    handleReadFirstDeployOnboarding,
  );
  app.patch(
    compartmentFirstDeployOnboardingSessionPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: firstDeployOnboardingSessionResponseSchema }),
    handlePatchFirstDeployOnboarding,
  );
  app.get(
    compartmentFirstDeployOnboardingStatusPathnameTemplate,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: firstDeployOnboardingStatusResponseSchema }),
    handleReadFirstDeployOnboardingStatus,
  );
}

async function handleCreateFirstDeployOnboarding(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const body: CreateFirstDeployOnboardingSessionRequest = parseRequestValue(
    createFirstDeployOnboardingSessionRequestSchema,
    request.body,
    invalidFirstDeployOnboardingRequestCode,
  );
  const response: FirstDeployOnboardingSessionResponse = firstDeployOnboardingSessionResponseSchema.parse({
    session: await createFirstDeployOnboarding({
      actorPrincipalId: request.actor.principalId,
      method: body.method,
      organizationId: request.currentOrganization.id,
      organizationSlug: request.currentOrganization.slug,
    }),
  });
  return await reply.send(response);
}

async function handleReadFirstDeployOnboarding(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: FirstDeployOnboardingSessionRouteParams = readRouteParams(request);
  const response: FirstDeployOnboardingSessionResponse = firstDeployOnboardingSessionResponseSchema.parse({
    session: await readFirstDeployOnboarding({
      actorPrincipalId: request.actor.principalId,
      organizationId: request.currentOrganization.id,
      organizationSlug: request.currentOrganization.slug,
      sessionId: params.sessionId,
    }),
  });
  return await reply.send(response);
}

async function handlePatchFirstDeployOnboarding(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: FirstDeployOnboardingSessionRouteParams = readRouteParams(request);
  const body: PatchFirstDeployOnboardingSessionRequest = parseRequestValue(
    patchFirstDeployOnboardingSessionRequestSchema,
    request.body,
    invalidFirstDeployOnboardingRequestCode,
  );
  const response: FirstDeployOnboardingSessionResponse = firstDeployOnboardingSessionResponseSchema.parse({
    session: await patchFirstDeployOnboarding({
      actorPrincipalId: request.actor.principalId,
      organizationId: request.currentOrganization.id,
      organizationSlug: request.currentOrganization.slug,
      patch: body,
      sessionId: params.sessionId,
    }),
  });
  return await reply.send(response);
}

async function handleReadFirstDeployOnboardingStatus(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const params: FirstDeployOnboardingSessionRouteParams = readRouteParams(request);
  const response: FirstDeployOnboardingStatusResponse = firstDeployOnboardingStatusResponseSchema.parse(
    await readFirstDeployOnboardingStatus({
      actorPrincipalId: request.actor.principalId,
      organizationId: request.currentOrganization.id,
      organizationSlug: request.currentOrganization.slug,
      sessionId: params.sessionId,
    }),
  );
  return await reply.send(response);
}

function readRouteParams(request: FastifyRequest): FirstDeployOnboardingSessionRouteParams {
  return parseRequestValue(
    firstDeployOnboardingSessionRouteParamsSchema,
    request.params,
    invalidFirstDeployOnboardingParamsCode,
  );
}
