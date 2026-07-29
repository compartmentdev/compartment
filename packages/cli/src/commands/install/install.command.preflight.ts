import { homedir } from 'node:os';
import { ReportedCliError } from '../../reported-error';
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
    dependencies.io.stderr(`✗ kubeconfig: ${failure.message}\n`);
    throw new ReportedCliError(failure.message);
  }
}
