import type { DeploymentRow } from './deployments.query.types';
import type { DeploymentProjectMutationRejection } from './deployment-project-mutation.query.types';

export type QueuedDeploymentBatchRejection = DeploymentProjectMutationRejection;
export type QueuedDeploymentBatchResult = DeploymentRow[] | QueuedDeploymentBatchRejection | undefined;
export type QueuedExistingArtifactDeploymentBatchResult = DeploymentRow[] | DeploymentProjectMutationRejection;
