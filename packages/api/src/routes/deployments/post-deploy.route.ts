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
import type { DeployResponseInput } from '../../services/presenter.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { recordDeploymentAuditEvents } from '../audit/privileged-operation-audit';
import { buildDeployResponse } from './deployment.presenter';

const invalidDeployRequestCode: string = 'invalid_deploy_request';

export function registerPostDeployRoute(app: ApiApp): void {
  app.post(
    compartmentDeploymentsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: deployResponseSchema }, 'deployment.created'),
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
  const result: DeployResponseInput = await createDeploymentsFromSourceUpload({
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
  });
  const response: DeployResponse = deployResponseSchema.parse(buildDeployResponse(result));
  await recordDeploymentAuditEvents(request, response, 'deployment.created', result.deployments);

  return response;
}
