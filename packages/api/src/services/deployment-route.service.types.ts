import type { DeploymentJoinedRow } from '../queries/deployments.query.types';

export interface DeploymentPublicRoute {
  routeHost: string;
  routeSubdomain: string;
}

export interface DeploymentPublicRouteContext {
  deployment: DeploymentJoinedRow;
}

export interface DeploymentPublicRouteReservationContext {
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  organizationId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  updatedAt: Date;
}
