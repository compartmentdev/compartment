import {
  compartmentDeploymentMetricsPathname,
  deploymentMetricsSnapshotSchema,
  deploymentStatusQuerySchema,
  type DeploymentMetricsSnapshot,
} from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import { getDeploymentStatusSummary } from '../../services/deployment-status.service';
import { readPodMetricsSnapshot } from '../../services/pod-metrics-snapshot.service';
import { registerDeploymentQueryRoute } from './deployment-query-route';
import type { DeploymentStatusLookupResult } from '../../services/deployments.service.types';

export function registerGetDeploymentMetricsRoute(app: ApiApp): void {
  registerDeploymentQueryRoute({
    app,
    buildResponse: (result: DeploymentStatusLookupResult): DeploymentMetricsSnapshot =>
      readPodMetricsSnapshot(result.deployments),
    currentOrganizationPermission: undefined,
    invalidQueryErrorCode: 'invalid_deployment_metrics_query',
    loadSummary: getDeploymentStatusSummary,
    path: compartmentDeploymentMetricsPathname,
    querySchema: deploymentStatusQuerySchema,
    responseSchema: deploymentMetricsSnapshotSchema,
  });
}
