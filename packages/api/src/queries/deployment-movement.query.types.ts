import type { PersistedDeploymentRow } from './deployments.query.types';

export interface DeploymentMovementTargetSelector {
  environmentId: string;
  projectServiceId: string;
}

export interface PersistedTargetDeploymentRow {
  deployment: PersistedDeploymentRow;
  operationType: string;
}
