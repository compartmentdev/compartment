import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { readPromptLine } from '../../prompts/prompt-reader';
import { ReportedCliError } from '../../reported-error';
import { resolveKubernetesInstallKubeconfig } from '../../services/kubernetes-install-kubeconfig.service';
import type { ResolvedKubernetesKubeconfig } from '../../services/kubernetes-install-kubeconfig.service.types';
import {
  KubernetesInstallPreflightError,
  runKubernetesInstallPreflight,
} from '../../services/kubernetes-install-preflight.service';
import type {
  KubernetesIngressPortConflict,
  KubernetesInstallPreflightResult,
} from '../../services/kubernetes-install-preflight.service.types';
import type { CliCommandDependencies } from '../command.types';
import type { InstallPreflightChecklistResult, KubernetesInstallTargetOptions } from './install.command.types';

export async function runInstallPreflightChecklist(
  dependencies: CliCommandDependencies,
  target: KubernetesInstallTargetOptions,
  detectStorageClass: boolean,
  confirmIngressWarnings: boolean,
): Promise<InstallPreflightChecklistResult> {
  const kubeconfig: ResolvedKubernetesKubeconfig = await resolvePreflightKubeconfig(dependencies, target.kubeContext);
  try {
    const preflight: KubernetesInstallPreflightResult = await runClusterChecks(
      dependencies,
      target,
      kubeconfig,
      detectStorageClass,
    );
    await handleIngressWarning(dependencies, preflight, confirmIngressWarnings);
    return { kubeconfig, preflight };
  } catch (error) {
    await removeMaterializedKubeconfig(kubeconfig);
    throw error;
  }
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
    throw new ReportedCliError(failure.message);
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
    if (result.ingressWarning === undefined) {
      dependencies.io.stderr('✓ ingress ports: no conflicting LoadBalancer found\n');
    }
    return result;
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Kubernetes preflight failed.');
    writeFailedClusterCheck(dependencies, failure, resolvedKubeconfig.clusterServer);
    throw new ReportedCliError(failure.message);
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
    dependencies.io.stderr(`✗ storage class: ${error.message}\n`);
    return;
  }
  dependencies.io.stderr(`✗ cluster: ${error.message}\n`);
}

async function handleIngressWarning(
  dependencies: CliCommandDependencies,
  preflight: KubernetesInstallPreflightResult,
  confirmIngressWarnings: boolean,
): Promise<void> {
  const conflict: KubernetesIngressPortConflict | undefined = preflight.ingressWarning;
  if (conflict === undefined) {
    return;
  }
  writeIngressWarning(dependencies, conflict);
  if (confirmIngressWarnings) {
    await confirmIngressWarning(dependencies);
  }
}

async function confirmIngressWarning(dependencies: CliCommandDependencies): Promise<void> {
  for (;;) {
    const answer: string = (await readPromptLine(dependencies.io, 'Continue installation? [y/N]: '))
      .trim()
      .toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      return;
    }
    if (answer === '' || answer === 'n' || answer === 'no') {
      throw new Error('Installation cancelled.');
    }
    dependencies.io.stderr('Enter `y` or `n`.\n');
  }
}

function writeIngressWarning(dependencies: CliCommandDependencies, conflict: KubernetesIngressPortConflict): void {
  dependencies.io.stderr(
    `⚠ ingress ports: Service ${conflict.namespace}/${conflict.name} also exposes 80/443. ` +
      'This can coexist when LoadBalancer Services receive separate addresses.\n',
  );
}

async function removeMaterializedKubeconfig(kubeconfig: ResolvedKubernetesKubeconfig): Promise<void> {
  if (kubeconfig.materializedDirectory !== undefined) {
    await rm(kubeconfig.materializedDirectory, { force: true, recursive: true });
  }
}
