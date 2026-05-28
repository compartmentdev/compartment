import type { DeploymentJoinedRow, EnvironmentRow } from '../queries/deployments.query.types';
import type { DeploymentProjectMutationRejection } from '../queries/deployment-project-mutation.query.types';
import type { ProjectRow } from '../queries/projects.query.types';

export type DeploymentMovementOperationType = 'deployment.promote' | 'deployment.rollback';
export type DeploymentMovementResult = DeploymentJoinedRow[] | DeploymentProjectMutationRejection;

export interface PromoteDeploymentInput {
  actorPrincipalId: string;
  organizationId: string;
  organizationSlug: string;
  projectName: string;
  scope: DeploymentMovementServiceScope;
  sourceEnvironmentName: string;
  targetEnvironmentName: string;
}

export interface RollbackDeploymentInput {
  actorPrincipalId: string;
  environmentName: string;
  organizationId: string;
  organizationSlug: string;
  projectName: string;
  target: RollbackDeploymentTarget;
}

export interface DeploymentMovementAllServicesScope {
  mode: 'all-services';
}

export interface DeploymentMovementSingleServiceScope {
  mode: 'service';
  serviceName: string;
}

export type DeploymentMovementServiceScope = DeploymentMovementAllServicesScope | DeploymentMovementSingleServiceScope;

export interface RollbackDeploymentInferServiceSelection {
  mode: 'infer-service';
}

export interface RollbackDeploymentSingleServiceSelection {
  mode: 'service';
  serviceName: string;
}

export type RollbackDeploymentServiceSelection =
  | RollbackDeploymentInferServiceSelection
  | RollbackDeploymentSingleServiceSelection;

export interface RollbackPreviousDeploymentTarget {
  mode: 'previous';
  scope: DeploymentMovementServiceScope;
}

export interface RollbackDeploymentIdTarget {
  mode: 'deployment';
  serviceSelection: RollbackDeploymentServiceSelection;
  targetDeploymentId: string;
}

export interface RollbackDeploymentRunTarget {
  mode: 'run';
  targetDeploymentRunId: string;
}

export type RollbackDeploymentTarget =
  | RollbackPreviousDeploymentTarget
  | RollbackDeploymentIdTarget
  | RollbackDeploymentRunTarget;

export interface DeploymentListInput {
  environmentName?: string | undefined;
  limit?: number | undefined;
  organizationSlug: string;
  principalId: string;
  projectName: string;
  serviceName?: string | undefined;
}

export interface DeploymentListResult {
  deployments: DeploymentJoinedRow[];
  environment: EnvironmentRow;
  project: ProjectRow;
}
