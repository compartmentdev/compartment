import type { ProjectProvisioningTarget, WorkerCompleteProjectProvisioningRequest } from '@compartment/contracts';
import { claimPendingProjectProvisioning, completeProjectProvisioning } from '../queries/project-provisioning.query';
import type { CompleteProjectProvisioningCleanupInput } from '../queries/project-provisioning.query.types';

export async function claimProjectProvisioning(): Promise<ProjectProvisioningTarget | null> {
  return await claimPendingProjectProvisioning();
}

export async function acknowledgeProjectProvisioning(
  input: WorkerCompleteProjectProvisioningRequest,
): Promise<boolean> {
  const common: Omit<CompleteProjectProvisioningCleanupInput, 'action'> = {
    failureMessage: input.message ?? null,
    leaseId: input.leaseId,
    projectId: input.projectId,
    status: input.status,
  };
  return input.action === 'cleanup'
    ? await completeProjectProvisioning({ ...common, action: 'cleanup' })
    : await completeProjectProvisioning({
        ...common,
        action: 'provision',
        cleanupRequired: input.cleanupRequired,
      });
}
