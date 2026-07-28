import type { ProjectProvisioningTargetV2, WorkerCompleteProjectProvisioningResponse } from '@compartment/contracts';
import { completeProjectProvisioningV2, type CompartmentRequester } from '@compartment/sdk';

class ProjectProvisioningLeaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProjectProvisioningLeaseError';
  }
}

export function rethrowProjectProvisioningLeaseError(error: object | null): void {
  if (error instanceof ProjectProvisioningLeaseError) {
    throw error;
  }
}

export async function assertProjectProvisioningLease(
  request: CompartmentRequester,
  target: ProjectProvisioningTargetV2,
): Promise<void> {
  let lease: WorkerCompleteProjectProvisioningResponse;
  try {
    lease = await completeProjectProvisioningV2(request, {
      action: target.action,
      isolationVersion: target.isolationVersion,
      leaseId: target.leaseId,
      projectId: target.projectId,
      status: 'running',
    });
  } catch (error) {
    const detail: string = error instanceof Error ? `: ${error.message}` : '';
    throw new ProjectProvisioningLeaseError(`Project provisioning lease could not be renewed${detail}`);
  }
  if (!lease.applied) {
    throw new ProjectProvisioningLeaseError('Project provisioning lease is no longer current.');
  }
}
