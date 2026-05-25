import type { AppAccessScopeType } from '@compartment/contracts';

export interface CompleteDeploymentWithRouteInput {
  accessScopeId: string;
  accessScopeType: AppAccessScopeType;
  completedAt: Date;
  containerId: string;
  deploymentId: string;
  drainDeadlineAt: Date | null;
  drainingContainerId: string | null;
  drainingDeploymentId: string | null;
  drainingNodeId: string | null;
  environmentId: string;
  imageRef: string;
  operationId: string;
  promotionStage: 'active' | 'draining_previous';
  buildArtifactId: string;
  routeHost: string;
  routeId: string;
  upstreamHost: string;
  upstreamPort: number;
  routeSubdomain: string;
  serviceId: string;
  updatedAt: Date;
}
