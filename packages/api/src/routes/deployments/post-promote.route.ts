import {
  compartmentDeploymentsPromotePathname,
  deployResponseSchema,
  promoteDeploymentRequestSchema,
  type DeployResponse,
  type PromoteDeploymentRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { promoteDeploymentsForPrincipal } from '../../services/deployment-movement.service';
import type { DeploymentMovementResult } from '../../services/deployment-movement.service.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { recordDeploymentAuditEvents } from '../audit/privileged-operation-audit';
import { buildDeploymentMovementServiceScope } from './deployment-movement-route.helpers';
import { buildDeployResponse } from './deployment.presenter';

export function registerPostPromoteRoute(app: ApiApp): void {
  app.post(
    compartmentDeploymentsPromotePathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: deployResponseSchema }, 'deployment.created'),
    handlePostPromoteRequest,
  );
}

async function handlePostPromoteRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: PromoteDeploymentRequest = parseRequestValue(
    promoteDeploymentRequestSchema,
    request.body,
    'invalid_promote_deployment_request',
  );
  const deployments: DeploymentMovementResult = await promoteDeploymentsForPrincipal({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
    projectName: input.projectName,
    scope: buildDeploymentMovementServiceScope(input.serviceName),
    sourceEnvironmentName: input.sourceEnvironmentName,
    targetEnvironmentName: input.targetEnvironmentName,
  });
  const response: DeployResponse = deployResponseSchema.parse(buildDeployResponse({ deployments, resources: [] }));
  await recordDeploymentAuditEvents(request, response, 'deployment.created', deployments);

  return await reply.send(response);
}
