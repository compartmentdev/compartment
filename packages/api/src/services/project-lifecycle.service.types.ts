import type { ProjectLifecycleAction, ProjectLifecycleState } from '@compartment/contracts';
import type { DeploymentProjectMutationRejection } from '../queries/deployment-project-mutation.query.types';
import type { DeploymentSummaryInput, EnvironmentSummaryInput, ProjectSummaryInput } from './presenter.types';

export interface ProjectLifecycleInput {
  environmentName: string;
  organizationSlug: string;
  principalId: string;
  projectName: string;
}

export interface ProjectLifecycleResult {
  action: ProjectLifecycleAction;
  deployments: DeploymentSummaryInput[];
  environment: EnvironmentSummaryInput;
  project: ProjectSummaryInput;
  state: ProjectLifecycleState;
}

export type ProjectLifecycleServiceResult = ProjectLifecycleResult | DeploymentProjectMutationRejection;
