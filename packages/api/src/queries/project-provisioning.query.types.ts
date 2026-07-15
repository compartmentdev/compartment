import type { ProjectProvisioningTarget } from '@compartment/contracts';

export type ProjectProvisioningClaimRow = ProjectProvisioningTarget;

export interface CompleteProjectProvisioningInput {
  failureMessage: string | null;
  leaseId: string;
  projectId: string;
  status: 'failed' | 'running' | 'succeeded';
}
