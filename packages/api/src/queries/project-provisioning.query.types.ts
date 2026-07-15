import type { ProjectProvisioningTarget } from '@compartment/contracts';

export type ProjectProvisioningClaimRow = ProjectProvisioningTarget;

export interface CompleteProjectProvisioningInput {
  action: 'provision';
  failureMessage: string | null;
  leaseId: string;
  projectId: string;
  status: 'failed' | 'succeeded';
}
