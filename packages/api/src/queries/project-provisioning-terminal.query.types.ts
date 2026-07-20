export interface TerminalProvisioningRow {
  failureMessage: string | null;
  projectId: string;
}

export interface ProjectProvisioningLockRow extends TerminalProvisioningRow {
  attempts: number;
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'policy-running' | 'policy-failed';
}

export interface WaitingDeploymentRow {
  deploymentId: string;
  deploymentRunId: string;
  operationId: string;
}
