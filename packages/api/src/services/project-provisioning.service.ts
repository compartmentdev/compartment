import type {
  ProjectProvisioningTarget,
  ProjectProvisioningTargetV2,
  WorkerCompleteProjectProvisioningRequest,
  WorkerCompleteProjectProvisioningV2Request,
} from '@compartment/contracts';
import { claimPendingProjectProvisioning, completeProjectProvisioning } from '../queries/project-provisioning.query';

export async function claimProjectProvisioning(): Promise<ProjectProvisioningTarget | null> {
  const target: ProjectProvisioningTargetV2 | null = await claimPendingProjectProvisioning('provision');
  return target === null
    ? null
    : { leaseId: target.leaseId, namespaceId: target.namespaceId, projectId: target.projectId };
}

export async function claimProjectProvisioningV2(): Promise<ProjectProvisioningTargetV2 | null> {
  return await claimPendingProjectProvisioning();
}

export async function acknowledgeProjectProvisioning(
  input: WorkerCompleteProjectProvisioningRequest,
): Promise<boolean> {
  return await completeProjectProvisioning({
    action: 'provision',
    failureMessage: input.message ?? null,
    leaseId: input.leaseId,
    projectId: input.projectId,
    status: input.status,
  });
}

export async function acknowledgeProjectProvisioningV2(
  input: WorkerCompleteProjectProvisioningV2Request,
): Promise<boolean> {
  return await completeProjectProvisioning({
    action: input.action,
    failureMessage: input.message ?? null,
    leaseId: input.leaseId,
    projectId: input.projectId,
    status: input.status,
  });
}
