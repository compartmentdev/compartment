import type { DeploymentReconcileState } from '@compartment/contracts';

export interface DeploymentReconcileRow {
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  image: string | null;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  resolvedReadinessJson: string;
  resolvedReleaseJson: string;
  revision: number;
  serviceId: string;
  serviceName: string;
  state: DeploymentReconcileState;
  transitionedAt: Date;
}

export interface DeploymentReconcilePair {
  active: DeploymentReconcileRow | null;
  candidate: DeploymentReconcileRow;
}

export interface PersistDeploymentReconcileObservationInput {
  deploymentId: string;
  failureMessage: string | null;
  observation: 'pending' | 'ready' | 'failed';
  observedAt: Date;
  revision: number;
}

export interface PrepareDeploymentReconcileInput {
  deploymentId: string;
  deploymentName: string;
  id: string;
  imageRef: string;
  namespace: string;
  networkPolicyNames: string[];
  routeId: string;
  routeSubdomain: string;
  serviceName: string;
}

export interface PrepareDeploymentRow {
  buildArtifactId: string;
  environmentId: string;
  serviceId: string;
}
