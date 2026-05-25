import {
  compartmentDeploymentLogsPathname,
  deploymentLogsQuerySchema,
  deploymentLogsResponseSchema,
  type DeploymentLogsQuery,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { getDeploymentLogsForEnvironment } from '../../services/deployment-logs.service';
import type { DeploymentLogsLookupResult } from '../../services/deployments.service.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { sendDeploymentLogsRouteResponse } from './deployment-logs.route.shared';
import { buildDeploymentReadLogsResponse } from './deployment-read.presenter';

export function registerGetDeploymentLogsRoute(app: ApiApp): void {
  app.get(
    compartmentDeploymentLogsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: deploymentLogsResponseSchema }),
    handleGetDeploymentLogsRequest,
  );
}

async function handleGetDeploymentLogsRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: DeploymentLogsQuery = parseRequestValue(
    deploymentLogsQuerySchema,
    request.query,
    'invalid_deployment_logs_query',
  );
  return await sendDeploymentLogsRouteResponse(
    reply,
    deploymentLogsResponseSchema,
    async (): Promise<DeploymentLogsLookupResult> =>
      await getDeploymentLogsForEnvironment({
        environmentName: query.environmentName,
        organizationSlug: request.currentOrganization.slug,
        principalId: request.actor.principalId,
        projectName: query.projectName,
        serviceName: query.serviceName,
        since: query.since,
        tailLines: query.tailLines,
      }),
    buildDeploymentReadLogsResponse,
  );
}
