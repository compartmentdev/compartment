import { homedir } from 'node:os';
import {
  KubernetesInstallPreflightError,
  resolveKubernetesInstallKubeconfig,
  runKubernetesInstallPreflight,
} from '../../services/kubernetes-install-preflight.service';
import type {
  KubernetesInstallPreflightResult,
  ResolvedKubernetesKubeconfig,
} from '../../services/kubernetes-install-preflight.service.types';
import type { CliCommandDependencies } from '../command.types';
import type { InstallPreflightChecklistResult, KubernetesInstallTargetOptions } from './install.command.types';

export async function runInstallPreflightChecklist(
  dependencies: CliCommandDependencies,
  target: KubernetesInstallTargetOptions,
  detectStorageClass: boolean,
): Promise<InstallPreflightChecklistResult> {
  const kubeconfig: ResolvedKubernetesKubeconfig = await resolvePreflightKubeconfig(dependencies, target.kubeContext);
  const preflight: KubernetesInstallPreflightResult = await runClusterChecks(
    dependencies,
    target,
    kubeconfig,
    detectStorageClass,
  );
  return { kubeconfig, preflight };
}

async function resolvePreflightKubeconfig(
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
    throw failure;
  }
}

async function runClusterChecks(
  dependencies: CliCommandDependencies,
  target: KubernetesInstallTargetOptions,
  resolvedKubeconfig: ResolvedKubernetesKubeconfig,
  detectStorageClass: boolean,
): Promise<KubernetesInstallPreflightResult> {
  try {
    const result: KubernetesInstallPreflightResult = await runKubernetesInstallPreflight({
      ...target,
      detectStorageClass,
      resolvedKubeconfig,
    });
    dependencies.io.stderr(`✓ cluster: reachable (${resolvedKubeconfig.clusterServer})\n`);
    dependencies.io.stderr('✓ ingress ports: 80/443 available\n');
    return result;
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Kubernetes preflight failed.');
    writeFailedClusterCheck(dependencies, failure, resolvedKubeconfig.clusterServer);
    throw failure;
  }
}

function writeFailedClusterCheck(dependencies: CliCommandDependencies, error: Error, clusterServer: string): void {
  if (error instanceof KubernetesInstallPreflightError && error.check === 'ingress ports') {
    dependencies.io.stderr(`✓ cluster: reachable (${clusterServer})\n`);
    dependencies.io.stderr(`✗ ingress ports: ${error.message}\n`);
    return;
  }
  if (error instanceof KubernetesInstallPreflightError && error.check === 'storage class') {
    dependencies.io.stderr(`✓ cluster: reachable (${clusterServer})\n`);
    dependencies.io.stderr('✓ ingress ports: 80/443 available\n');
    dependencies.io.stderr(`✗ storage class: ${error.message}\n`);
    return;
  }
  dependencies.io.stderr(`✗ cluster: ${error.message}\n`);
}
