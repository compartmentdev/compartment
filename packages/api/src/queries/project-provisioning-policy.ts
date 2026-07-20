export const projectProvisioningAttemptLimit: number = 3;
export const projectProvisioningGeneration: number = 1;
export const projectProvisioningLeaseDurationMs: number = 7 * 60_000;
export const projectProvisioningRetryDelayMs: number = 10_000;

export function projectProvisioningTerminalFailure(failureMessage: string | null): string {
  const detail: string = failureMessage ?? 'Project Kubernetes provisioning failed.';
  return `Project is unprovisionable after ${projectProvisioningAttemptLimit} attempts: ${detail}`;
}
