import {
  compartmentDeploymentsInspectPathname,
  deploymentInspectQuerySchema,
  deploymentInspectResponseSchema,
  type DeploymentInspectResponse,
} from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { resolveInheritedAccess } from '../../services/access-scope.service';
import type { EffectiveAccess } from '../../services/access-scope.service.types';
import { getDeploymentInspectSummary } from '../../services/deployment-inspect.service';
import type { DeploymentInspectLookupResult } from '../../services/deployments.service.types';
import { registerDeploymentQueryRoute } from './deployment-query-route';
import { buildDeploymentInspectResponseForRole } from './deployment.presenter';

export function registerGetDeploymentInspectRoute(app: ApiApp): void {
  registerDeploymentQueryRoute({
    app,
    buildResponse: async (
      summary: DeploymentInspectLookupResult,
      request: FastifyRequest,
    ): Promise<DeploymentInspectResponse> =>
      buildDeploymentInspectResponseForRole(summary, await readSensitiveTopologyVisible(summary, request)),
    invalidQueryErrorCode: 'invalid_deployment_inspect_query',
    loadSummary: getDeploymentInspectSummary,
    currentOrganizationPermission: undefined,
    path: compartmentDeploymentsInspectPathname,
    querySchema: deploymentInspectQuerySchema,
    responseSchema: deploymentInspectResponseSchema,
  });
}

async function readSensitiveTopologyVisible(
  summary: DeploymentInspectLookupResult,
  request: FastifyRequest,
): Promise<boolean> {
  const access: EffectiveAccess | null = await resolveInheritedAccess({
    organizationId: request.currentOrganization.id,
    principalId: request.actor.principalId,
    routeScope: {
      scopeId: summary.environment.id,
      scopeType: 'environment',
    },
  });

  return access?.permissions.includes('deployment.create') === true;
}
