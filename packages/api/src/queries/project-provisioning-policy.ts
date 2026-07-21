export const projectProvisioningAttemptLimit: number = 3;
export const projectProvisioningLeaseDurationMs: number = 7 * 60_000;
export const projectProvisioningRetryDelayMs: number = 10_000;
export const projectTeardownLeaseDurationMs: number = 45_000;

export function projectProvisioningTerminalFailure(failureMessage: string | null): string {
  const detail: string = failureMessage ?? 'Project Kubernetes provisioning failed.';
  return `Project is unprovisionable after ${projectProvisioningAttemptLimit} attempts: ${detail}`;
}

export function projectTeardownTerminalFailure(failureMessage: string | null): string {
  const detail: string = failureMessage ?? 'Project Kubernetes teardown failed.';
  return `Project Kubernetes teardown failed after ${projectProvisioningAttemptLimit} attempts: ${detail}`;
}
