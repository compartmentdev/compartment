import {
  compartmentDeploymentsRollbackPathname,
  deployResponseSchema,
  rollbackDeploymentRequestSchema,
  type DeployResponse,
  type RollbackDeploymentRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { rollbackDeploymentForPrincipal } from '../../services/deployment-movement.service';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildRollbackDeploymentTarget } from './deployment-movement-route.helpers';
import { buildDeployResponse } from './deployment.presenter';

export function registerPostRollbackRoute(app: ApiApp): void {
  app.post(
    compartmentDeploymentsRollbackPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: deployResponseSchema }),
    handlePostRollbackRequest,
  );
}

async function handlePostRollbackRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: RollbackDeploymentRequest = parseRequestValue(
    rollbackDeploymentRequestSchema,
    request.body,
    'invalid_rollback_deployment_request',
  );
  const deployResponse: DeployResponse = deployResponseSchema.parse(
    buildDeployResponse({
      deployments: await rollbackDeploymentForPrincipal({
        actorPrincipalId: request.actor.principalId,
        environmentName: input.environmentName,
        organizationId: request.currentOrganization.id,
        organizationSlug: request.currentOrganization.slug,
        projectName: input.projectName,
        target: buildRollbackDeploymentTarget(input),
      }),
      resources: [],
    }),
  );

  return await reply.send(deployResponse);
}
