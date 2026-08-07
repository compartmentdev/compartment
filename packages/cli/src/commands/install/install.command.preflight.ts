import { homedir } from 'node:os';
import { ReportedCliError } from '../../reported-error';
import { KubernetesInstallKubeconfigResolutionError } from '../../services/kubernetes-install-kubeconfig.error';
import { resolveKubernetesInstallKubeconfig } from '../../services/kubernetes-install-kubeconfig.service';
import type { ResolvedKubernetesKubeconfig } from '../../services/kubernetes-install-kubeconfig.service.types';
import type { CliCommandDependencies } from '../command.types';

export async function resolvePreflightKubeconfig(
  dependencies: CliCommandDependencies,
  contextName: string | undefined,
): Promise<ResolvedKubernetesKubeconfig> {
  try {
    const resolved: ResolvedKubernetesKubeconfig = await resolveKubernetesInstallKubeconfig({
      env: process.env,
      homeDirectory: homedir(),
      ...(contextName === undefined ? {} : { contextName }),
    });
    const suffix: string = resolved.label === undefined ? '' : ` (${resolved.label})`;
    dependencies.io.stderr(`✓ kubeconfig: ${resolved.path}${suffix}\n`);
    return resolved;
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Kubeconfig resolution failed.');
    const message: string =
      failure instanceof KubernetesInstallKubeconfigResolutionError && failure.reason === 'no-usable-cluster'
        ? 'No usable Kubernetes cluster found.\n\nCompartment installs into an existing Kubernetes cluster.\n\nInstall a supported cluster or set KUBECONFIG to an existing one.\n\nAlso required: kubectl >= 1.35 and Helm >= 4.'
        : failure.message;
    dependencies.io.stderr(`✗ kubeconfig: ${message}\n`);
    throw new ReportedCliError(message);
  }
}
