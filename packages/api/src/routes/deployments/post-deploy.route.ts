import {
  compartmentDeploymentsPathname,
  deployRequestSchema,
  deployResponseSchema,
  type DeployRequest,
  type DeployResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { createDeploymentsFromSourceUpload } from '../../services/deployment-creation.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildDeployResponse } from './deployment.presenter';

const invalidDeployRequestCode: string = 'invalid_deploy_request';

export function registerPostDeployRoute(app: ApiApp): void {
  app.post(
    compartmentDeploymentsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: deployResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await reply.send(await buildDeployResponsePayload(request)),
  );
}

async function buildDeployResponsePayload(request: FastifyRequest): Promise<DeployResponse> {
  const input: DeployRequest = parseDeployRouteRequest(request);

  return await createDeployResponsePayload(request, input);
}

function parseDeployRouteRequest(request: FastifyRequest): DeployRequest {
  return parseRequestValue(deployRequestSchema, request.body, invalidDeployRequestCode);
}

async function createDeployResponsePayload(request: FastifyRequest, input: DeployRequest): Promise<DeployResponse> {
  return deployResponseSchema.parse(
    buildDeployResponse(
      await createDeploymentsFromSourceUpload({
        actorPrincipalId: request.actor.principalId,
        descriptor: input.descriptor,
        environmentName: input.environmentName,
        label: input.label,
        onboardingSessionId: input.onboardingSessionId,
        organizationId: request.currentOrganization.id,
        organizationSlug: request.currentOrganization.slug,
        routes: input.routes,
        serviceName: input.serviceName,
        sourceUploadId: input.sourceUploadId,
      }),
    ),
  );
}
