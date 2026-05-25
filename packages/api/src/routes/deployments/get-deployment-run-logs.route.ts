import {
  compartmentDeploymentRunLogsPathname,
  deploymentRunLogsQuerySchema,
  deploymentRunLogsResponseSchema,
  type DeploymentRunLogsQuery,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import '../../http/request.types';
import { getDeploymentRunLogs } from '../../services/deployment-run-logs.service';
import type { DeploymentLogsLookupInput, DeploymentRunLogsLookupInput } from '../../services/deployments.service.types';
import type { DeploymentRunLogsResponseInput } from '../../services/presenter.types';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { sendDeploymentLogsRouteResponse } from './deployment-logs.route.shared';
import { buildDeploymentRunLogsResponse } from './deployment-run.presenter';

export function registerGetDeploymentRunLogsRoute(app: ApiApp): void {
  app.get(
    compartmentDeploymentRunLogsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: deploymentRunLogsResponseSchema }),
    createGetDeploymentRunLogsHandler(),
  );
}

function createGetDeploymentRunLogsHandler(): RouteHandlerMethod {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const query: DeploymentRunLogsQuery = parseRequestValue(
      deploymentRunLogsQuerySchema,
      request.query,
      'invalid_deployment_run_logs_query',
    );
    return await sendDeploymentLogsRouteResponse(
      reply,
      deploymentRunLogsResponseSchema,
      async (): Promise<DeploymentRunLogsResponseInput> =>
        await getDeploymentRunLogs(buildDeploymentRunLogsLookupInput(query, request)),
      buildDeploymentRunLogsResponse,
    );
  };
}

function buildDeploymentRunLogsLookupInput(
  query: DeploymentRunLogsQuery,
  request: FastifyRequest,
): DeploymentRunLogsLookupInput {
  const commonInput: DeploymentLogsLookupInput = {
    environmentName: query.environmentName,
    organizationSlug: request.currentOrganization.slug,
    principalId: request.actor.principalId,
    projectName: query.projectName,
    serviceName: query.serviceName,
    since: query.since,
    tailLines: query.tailLines,
  };
  if (query.selector === 'latest') {
    return {
      ...commonInput,
      selector: 'latest',
    };
  }

  return {
    ...commonInput,
    deploymentRunId: query.deploymentRunId,
    selector: 'run',
  };
}
