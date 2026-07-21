import type { ProjectProvisioningAction, ProjectProvisioningTargetV2 } from '@compartment/contracts';

export type ProjectProvisioningClaimRow = ProjectProvisioningTargetV2;
export type ProjectProvisioningCompletionStatus = 'failed' | 'running' | 'succeeded';
export type ProjectProvisioningClaimPhase = 'failed' | 'pending' | 'running';
export type ProjectKubeProvisioningState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'teardown_preparing'
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

export type ProjectTeardownState = 'preparing' | 'pending' | 'running' | 'succeeded' | 'failed';

export interface ProjectTeardownObservation {
  attempts: number;
  failureMessage: string | null;
  state: ProjectTeardownState;
}

export interface ProjectTeardownPreparationResult {
  preparationLeaseId: string | null;
  recoveredTerminalFailureMessage: string | null;
}
