import type { DeploymentListResponse } from '@compartment/contracts';
import type { ProjectScopeInput } from './projects.service.types';
import type { DeploymentStatusReporter } from './deployments.types';
import type { CommandProgressReporter } from './progress.types';

export interface PromoteCommandInput extends ProjectScopeInput {
  onStatusUpdate?: DeploymentStatusReporter | undefined;
  reportProgress?: CommandProgressReporter | undefined;
  scope: DeploymentCommandServiceScope;
  sourceEnvironmentName: string;
  targetEnvironmentName?: string | undefined;
}

export interface RollbackCommandInput extends ProjectScopeInput {
  environmentName?: string | undefined;
  onStatusUpdate?: DeploymentStatusReporter | undefined;
  reportProgress?: CommandProgressReporter | undefined;
  target: RollbackCommandTarget;
}

export interface AllServicesCommandScope {
  kind: 'all';
}

export interface SingleServiceCommandScope {
  kind: 'service';
  serviceName: string;
}

export type DeploymentCommandServiceScope = AllServicesCommandScope | SingleServiceCommandScope;

export interface RollbackPreviousCommandTarget {
  mode: 'previous';
  scope: DeploymentCommandServiceScope;
}

export interface RollbackDeploymentCommandTarget {
  mode: 'deployment';
  scope: DeploymentCommandServiceScope;
  targetDeploymentId: string;
}

export interface RollbackRunCommandTarget {
  mode: 'run';
  targetDeploymentRunId: string;
}

export type RollbackCommandTarget =
  | RollbackPreviousCommandTarget
  | RollbackDeploymentCommandTarget
  | RollbackRunCommandTarget;

export interface RollbackDeploymentRequestOptions {
  serviceName?: string | undefined;
  targetDeploymentId?: string | undefined;
  targetDeploymentRunId?: string | undefined;
}

export interface DeploymentListCommandInput extends ProjectScopeInput {
  environmentName?: string | undefined;
  limit?: number | undefined;
  serviceName?: string | undefined;
}

export interface ProjectDeploymentListResult {
  environmentName: string;
  response: DeploymentListResponse;
}
