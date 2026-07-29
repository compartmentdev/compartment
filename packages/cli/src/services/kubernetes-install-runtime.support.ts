import { randomBytes } from 'node:crypto';
import { waitForPublicControlPlane } from './kubernetes-install-public.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import type { KubernetesInstallProgressReporter } from './kubernetes-install-progress.types';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentResult,
  KubernetesInstallDomainMode,
} from './kubernetes-install.service.types';

const installTokenByteLength: number = 32;

export async function finishKubernetesInstall(
  apiUrl: string,
  installToken: string,
  baseDomain: string,
  domainMode: KubernetesInstallDomainMode,
  progress?: KubernetesInstallProgressReporter,
): Promise<KubernetesInstallDeploymentResult> {
  const message: string =
    domainMode === 'managed' ? 'Issuing TLS certificate (ACME)' : 'Waiting for public control plane';
  return await runObservableInstallStep(progress, message, async (): Promise<KubernetesInstallDeploymentResult> => {
    await waitForPublicControlPlane(apiUrl);
    return { apiUrl, baseDomain, installToken };
  });
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

export function createInstallToken(): string {
  return randomBytes(installTokenByteLength).toString('hex');
}
