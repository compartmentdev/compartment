import type { WorkerCompleteProjectProvisioningV2Request } from '@compartment/contracts';
import { completeProjectProvisioning } from '../queries/project-provisioning-completion.query';
import {
  claimPendingProjectProvisioning,
  failExhaustedProjectTeardownLeases,
} from '../queries/project-provisioning.query';
import { projectProvisioningAttemptLimit } from '../queries/project-provisioning-policy';
import { readProjectTeardownState } from '../queries/project-teardown.query';
import type { ProjectTeardownObservation } from '../queries/project-provisioning.query.types';
import type {
  ProjectProvisioningAcknowledgement,
  ProjectProvisioningClaim,
} from './project-provisioning.service.types';

export async function claimProjectProvisioningV2(
  resourceConfigurationFingerprint: string,
): Promise<ProjectProvisioningClaim> {
  const terminalFailureProjectIds: string[] = await failExhaustedProjectTeardownLeases();
  return {
    target: await claimPendingProjectProvisioning(resourceConfigurationFingerprint),
    terminalFailureProjectIds,
  };
}

export async function acknowledgeProjectProvisioningV2(
  input: WorkerCompleteProjectProvisioningV2Request,
): Promise<ProjectProvisioningAcknowledgement> {
  const applied: boolean = await completeProjectProvisioning({
    action: input.action,
    failureMessage: input.message ?? null,
    isolationVersion: input.isolationVersion,
    leaseId: input.leaseId,
    projectId: input.projectId,
    status: input.status,
  });
  const teardown: ProjectTeardownObservation | null =
    applied && input.action === 'teardown' && input.status === 'failed'
      ? await readProjectTeardownState(input.projectId)
      : null;
  return {
    applied,
    terminalFailure: teardown?.state === 'failed' && teardown.attempts >= projectProvisioningAttemptLimit,
  };
}
