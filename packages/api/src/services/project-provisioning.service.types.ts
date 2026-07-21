import type { ProjectProvisioningTargetV2 } from '@compartment/contracts';

export interface ProjectProvisioningAcknowledgement {
  applied: boolean;
  terminalFailure: boolean;
}

export interface ProjectProvisioningClaim {
  target: ProjectProvisioningTargetV2 | null;
  terminalFailureProjectIds: string[];
}
