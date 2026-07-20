import type { ProjectProvisioningTarget } from '@compartment/contracts';

export type ProjectProvisioningClaimRow = ProjectProvisioningTarget;

export interface CompleteProjectProvisioningInput {
  failureMessage: string | null;
  generation: number;
  leaseId: string;
  projectId: string;
  status: 'failed' | 'running' | 'succeeded';
}
