import {
  compartmentDeploymentsPathname,
  deploymentListQuerySchema,
  deploymentListResponseSchema,
  type DeploymentListQuery,
  type DeploymentListResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { listDeploymentsForPrincipal } from '../../services/deployment-list.service';
import type { DeploymentListResult } from '../../services/deployment-movement.service.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { buildDeploymentListResponse } from './deployment-list.presenter';

export function registerGetDeploymentListRoute(app: ApiApp): void {
  app.get(
    compartmentDeploymentsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: deploymentListResponseSchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const query: DeploymentListQuery = parseRequestValue(
        deploymentListQuerySchema,
        request.query,
        'invalid_deployment_list_query',
      );
      const result: DeploymentListResult = await listDeploymentsForPrincipal({
        environmentName: query.environmentName,
        limit: query.limit,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: query.projectName,
        serviceName: query.serviceName,
      });
      const response: DeploymentListResponse = deploymentListResponseSchema.parse(buildDeploymentListResponse(result));

      return await reply.send(response);
    },
  );
}
