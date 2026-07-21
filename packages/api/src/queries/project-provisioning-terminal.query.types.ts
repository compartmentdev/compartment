import type { ProjectKubeProvisioningState } from './project-provisioning.query.types';

export interface TerminalProvisioningRow {
  failureMessage: string | null;
  projectId: string;
}

export interface ProjectProvisioningLockRow extends TerminalProvisioningRow {
  attempts: number;
  state: ProjectKubeProvisioningState;
}

export interface WaitingDeploymentRow {
  deploymentId: string;
  deploymentRunId: string;
}
