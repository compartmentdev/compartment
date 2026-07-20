import type { ProjectProvisioningTarget, WorkerCompleteProjectProvisioningRequest } from '@compartment/contracts';
import { claimPendingProjectProvisioning, completeProjectProvisioning } from '../queries/project-provisioning.query';

export async function claimProjectProvisioning(): Promise<ProjectProvisioningTarget | null> {
  return await claimPendingProjectProvisioning();
}

export async function acknowledgeProjectProvisioning(
  input: WorkerCompleteProjectProvisioningRequest,
): Promise<boolean> {
  return await completeProjectProvisioning({
    failureMessage: input.message ?? null,
    leaseId: input.leaseId,
    projectId: input.projectId,
    status: input.status,
  });
}
