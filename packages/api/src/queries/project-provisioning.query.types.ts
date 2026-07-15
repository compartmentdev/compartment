import type { ProjectProvisioningTarget } from '@compartment/contracts';

export type ProjectProvisioningClaimRow = ProjectProvisioningTarget;

interface CompleteProjectProvisioningInputBase {
  failureMessage: string | null;
  leaseId: string;
  projectId: string;
  status: 'failed' | 'succeeded';
}

export interface CompleteProjectProvisioningCleanupInput extends CompleteProjectProvisioningInputBase {
  action: 'cleanup';
}

export interface CompleteProjectProvisioningExecutionInput extends CompleteProjectProvisioningInputBase {
  action: 'provision';
  cleanupRequired: boolean;
}

export type CompleteProjectProvisioningInput =
  | CompleteProjectProvisioningCleanupInput
  | CompleteProjectProvisioningExecutionInput;
