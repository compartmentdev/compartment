import type { ProjectProvisioningAction, ProjectProvisioningTarget } from '@compartment/contracts';

export type ProjectProvisioningClaimRow = ProjectProvisioningTarget;
export type ProjectProvisioningCompletionStatus = 'failed' | 'running' | 'succeeded';
export type ProjectKubeProvisioningState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'teardown_pending'
  | 'teardown_running'
  | 'teardown_succeeded'
  | 'teardown_failed';

export interface CompleteProjectProvisioningInput {
  action: ProjectProvisioningAction;
  failureMessage: string | null;
  leaseId: string;
  projectId: string;
  status: ProjectProvisioningCompletionStatus;
}

export type ProjectTeardownState = 'pending' | 'running' | 'succeeded' | 'failed';
