import type { ProjectProvisioningAction, ProjectProvisioningTargetV2 } from '@compartment/contracts';
import type { projectKubeProvisioning } from '../db/schema';

export type ProjectProvisioningClaimRow = ProjectProvisioningTargetV2;
export interface ProjectProvisioningClaimSelection {
  organizationId: string;
  projectName: string;
  provisioning: typeof projectKubeProvisioning.$inferSelect;
}
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
  isolationVersion: number;
  leaseId: string;
  projectId: string;
  status: ProjectProvisioningCompletionStatus;
}

export type ProjectTeardownState = 'preparing' | 'pending' | 'running' | 'succeeded' | 'failed';

export interface ProjectTeardownObservation {
  attempts: number;
  state: ProjectTeardownState;
}

export interface ProjectTeardownPreparationResult {
  preparationLeaseId: string | null;
  recoveredTerminalFailureMessage: string | null;
}
