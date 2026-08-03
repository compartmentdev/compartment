import type { KubernetesInstallKubeconfigFailureReason } from './kubernetes-install-kubeconfig.service.types';

export class KubernetesInstallKubeconfigResolutionError extends Error {
  readonly reason: KubernetesInstallKubeconfigFailureReason;

  constructor(message: string, reason: KubernetesInstallKubeconfigFailureReason) {
    super(message);
    this.reason = reason;
  }
}

export function buildKubernetesInstallKubeconfigResolutionError(
  checked: readonly string[],
  contextName?: string,
  configured: boolean = false,
  contextMissing: boolean = false,
): KubernetesInstallKubeconfigResolutionError {
  const prefix: string =
    contextName !== undefined && contextMissing ? `context "${contextName}" not found.` : 'No usable kubeconfig found.';
  const environmentChecked: string = configured ? '' : '$KUBECONFIG (not set), ';
  const checkedMessage: string = ` Checked: ${environmentChecked}${checked.join(', ')}.`;
  let message: string;
  if (checked.some((value: string): boolean => value.includes('run with sudo or export KUBECONFIG'))) {
    message = `${prefix}${checkedMessage}`;
  } else {
    message = configured
      ? `${prefix}${checkedMessage} Fix the configured path or context; no fallback kubeconfig was used.`
      : `${prefix}${checkedMessage} If you have a cluster, point KUBECONFIG at it. If not, install one first and keep its Ingress Controller enabled.`;
  }
  return new KubernetesInstallKubeconfigResolutionError(
    message,
    contextMissing ? 'context-not-found' : 'no-usable-cluster',
  );
}
