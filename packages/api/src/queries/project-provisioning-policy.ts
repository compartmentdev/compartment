export const projectProvisioningAttemptLimit: number = 3;
export const expiredProjectProvisioningLeaseMessage: string =
  'Project Kubernetes provisioning lease expired at the attempt limit.';

export function projectProvisioningTerminalFailure(failureMessage: string | null): string {
  const detail: string = failureMessage ?? 'Project Kubernetes provisioning failed.';
  return `Project is unprovisionable after ${projectProvisioningAttemptLimit} attempts: ${detail}`;
}
