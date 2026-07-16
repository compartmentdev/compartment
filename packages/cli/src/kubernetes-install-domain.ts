import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallState,
  KubernetesPublicProtocol,
} from './services/kubernetes-install.service.types';

export function isReservedKubernetesInstallLocalhostDomain(hostname: string | undefined): boolean {
  return hostname === 'localhost' || hostname?.endsWith('.localhost') === true;
}

export function assertMatchingKubernetesInstallDomain(
  input: KubernetesInstallDeploymentInput,
  existingInstall: KubernetesInstallState,
): void {
  if (existingInstall.domainMode !== input.domainMode) {
    throw new Error(
      `The existing Helm release uses ${existingInstall.domainMode} domain mode, not ${input.domainMode}. Retry with the original domain selection or use a different release name.`,
    );
  }
  if (input.domainMode === 'custom' && existingInstall.baseDomain !== requireCustomBaseDomain(input.baseDomain)) {
    throw new Error(
      `The existing Helm release uses base domain ${existingInstall.baseDomain}, not ${input.baseDomain ?? ''}. Retry with the installed base domain or use a different release name.`,
    );
  }
}

export function resolveKubernetesInstallControlPlaneUrl(
  configuredUrl: string | undefined,
  baseDomain: string,
  publicProtocol: KubernetesPublicProtocol,
): string {
  const expectedHostname: string = `console.${baseDomain}`;
  if (configuredUrl === undefined) {
    return `${publicProtocol}://${expectedHostname}`;
  }
  if (new URL(configuredUrl).hostname !== expectedHostname) {
    throw new Error(`--api-url must use the control-plane host ${expectedHostname}.`);
  }
  return configuredUrl;
}

function requireCustomBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined) {
    return baseDomain;
  }
  throw new Error('Custom-domain install requires --base-domain.');
}
