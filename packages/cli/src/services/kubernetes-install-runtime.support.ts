import { randomBytes } from 'node:crypto';
import { waitForPublicControlPlane } from './kubernetes-install-public.service';
import type { ExistingKubernetesInstall, KubernetesInstallDeploymentResult } from './kubernetes-install.service.types';

const installTokenByteLength: number = 32;

export async function finishKubernetesInstall(
  apiUrl: string,
  installToken: string,
  baseDomain: string,
): Promise<KubernetesInstallDeploymentResult> {
  await waitForPublicControlPlane(apiUrl);
  return { apiUrl, baseDomain, installToken };
}

export function requireFoundationInstall(existingInstall: ExistingKubernetesInstall | null): ExistingKubernetesInstall {
  if (existingInstall?.stage === 'foundation') {
    return existingInstall;
  }
  throw new Error('The Helm foundation stage did not persist a resumable installation state.');
}

export function requireExistingInstallToken(existingInstall: ExistingKubernetesInstall): string {
  if (existingInstall.installToken !== null) {
    return existingInstall.installToken;
  }
  throw new Error(
    'The existing full Helm release has no resumable install token. Use login if it is initialized, or set secrets.installToken through the operator workflow.',
  );
}

export function requireExistingBaseDomain(existingInstall: ExistingKubernetesInstall): string {
  if (existingInstall.baseDomain !== '') {
    return existingInstall.baseDomain;
  }
  throw new Error('The existing full Helm release has no resolved base domain.');
}

export function readInstallationId(existingInstall: ExistingKubernetesInstall | null): string | null {
  return existingInstall !== null && existingInstall.installationId !== '' ? existingInstall.installationId : null;
}

export function createInstallToken(): string {
  return randomBytes(installTokenByteLength).toString('hex');
}
