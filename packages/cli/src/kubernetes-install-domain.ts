import { quoteShellArgumentWhenNeeded } from '@compartment/utils';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesPublicProtocol,
} from './services/kubernetes-install.service.types';

export function isReservedKubernetesInstallLocalhostDomain(hostname: string | undefined): boolean {
  return hostname === 'localhost' || hostname?.endsWith('.localhost') === true;
}

export function assertMatchingKubernetesInstallDomain(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): void {
  if (existingInstall.domainMode !== input.domainMode) {
    if (existingInstall.stage === 'foundation') {
      throw new Error(
        `The incomplete Helm release uses ${existingInstall.domainMode} domain mode, not ${input.domainMode}. Remove the incomplete installation before retrying with the new domain selection: ${formatIncompleteInstallRemoval(input)}`,
      );
    }
    throw new Error(
      `The existing Helm release uses ${existingInstall.domainMode} domain mode, not ${input.domainMode}. Retry with the original domain selection or use a different release name.`,
    );
  }
  if (input.domainMode === 'custom' && existingInstall.baseDomain !== requireCustomBaseDomain(input.baseDomain)) {
    throw new Error(
      `The existing Helm release uses base domain ${existingInstall.baseDomain}, not ${input.baseDomain ?? ''}. Retry with the installed base domain or use a different release name.`,
    );
  }
  assertMatchingOperatorProtocol(input, existingInstall);
}

function assertMatchingOperatorProtocol(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): void {
  if (
    input.domainMode === 'custom' &&
    existingInstall.stage === 'full' &&
    input.publicProtocol !== undefined &&
    existingInstall.publicProtocol !== input.publicProtocol
  ) {
    throw new Error(
      `The existing Helm release uses ${existingInstall.publicProtocol} for its operator-owned domain, not ${input.publicProtocol}. Retry with the original TLS selection or use a different release name.`,
    );
  }
}

function formatIncompleteInstallRemoval(input: KubernetesInstallDeploymentInput): string {
  const helmCommand: string[] = [
    'helm',
    'uninstall',
    input.releaseName,
    '-n',
    input.namespace,
    ...(input.kubeconfigPath === undefined ? [] : ['--kubeconfig', input.kubeconfigPath]),
    ...(input.kubeContext === undefined ? [] : ['--kube-context', input.kubeContext]),
  ];
  const kubectlCommand: string[] = [
    'kubectl',
    ...(input.kubeconfigPath === undefined ? [] : ['--kubeconfig', input.kubeconfigPath]),
    ...(input.kubeContext === undefined ? [] : ['--context', input.kubeContext]),
    'delete',
    'ns',
    input.namespace,
  ];
  return `${formatShellCommand(helmCommand)} && ${formatShellCommand(kubectlCommand)}`;
}

function formatShellCommand(command: readonly string[]): string {
  return command.map(quoteShellArgumentWhenNeeded).join(' ');
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
  const parsedUrl: URL = new URL(configuredUrl);
  if (parsedUrl.hostname !== expectedHostname) {
    throw new Error(`--api-url must use the control-plane host ${expectedHostname}.`);
  }
  if (parsedUrl.protocol !== `${publicProtocol}:`) {
    throw new Error(`--api-url must use ${publicProtocol} for the selected operator-domain TLS mode.`);
  }
  return configuredUrl;
}

function requireCustomBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined) {
    return baseDomain;
  }
  throw new Error('Custom-domain install requires --base-domain.');
}
