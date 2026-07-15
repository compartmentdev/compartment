export interface TerminalProvisioningRow {
  failureMessage: string | null;
  projectId: string;
}

export interface WaitingDeploymentRow {
  deploymentId: string;
  deploymentRunId: string;
}
