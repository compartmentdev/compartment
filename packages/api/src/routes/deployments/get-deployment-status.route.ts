import {
  compartmentDeploymentsStatusPathname,
  deploymentStatusQuerySchema,
  deploymentStatusResponseSchema,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import { getDeploymentStatusSummary } from '../../services/deployment-status.service';
import { registerDeploymentQueryRoute } from './deployment-query-route';
import { buildDeploymentReadStatusResponse } from './deployment-read.presenter';

export function registerGetDeploymentStatusRoute(app: ApiApp): void {
  registerDeploymentQueryRoute({
    app,
    buildResponse: buildDeploymentReadStatusResponse,
    currentOrganizationPermission: undefined,
    invalidQueryErrorCode: 'invalid_deployment_status_query',
    loadSummary: getDeploymentStatusSummary,
    path: compartmentDeploymentsStatusPathname,
    querySchema: deploymentStatusQuerySchema,
    responseSchema: deploymentStatusResponseSchema,
  });
}
