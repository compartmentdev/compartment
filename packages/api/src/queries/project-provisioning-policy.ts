export const projectProvisioningAttemptLimit: number = 3;

export function projectProvisioningTerminalFailure(failureMessage: string | null): string {
  const detail: string = failureMessage ?? 'Project Kubernetes provisioning failed.';
  return `Project is unprovisionable after ${projectProvisioningAttemptLimit} attempts: ${detail}`;
}
