import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { promptManagedKubernetesInstall } from '../../prompts/prompt';
import { ReportedCliError } from '../../reported-error';
import { inspectManagedVmState } from '../../services/managed-vm-host-runtime.service';
import {
  formatKubernetesVersionRequirement,
  kubernetesInstallCompatibility,
} from '../../services/kubernetes-install-compatibility.service';
import { selectInstallTarget, type InstallTargetDiscovery } from '../../services/managed-vm-target.service';
import type { ManagedVmObservedState } from '../../services/managed-vm-provisioning.types';
import type { CliCommandDependencies } from '../command.types';
import type { InstallCommandOptions, InstallInputStream } from './install.command.types';

export async function resolveInstallCommandTarget(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<InstallTargetDiscovery> {
  const state: ManagedVmObservedState = await inspectManagedVmState();
  const discovery: InstallTargetDiscovery = await selectInstallTarget({
    contextName: options.kubeContext,
    env: process.env,
    explicitTarget: options.target,
    homeDirectory: homedir(),
    interactive: (dependencies.io.stdin as InstallInputStream).isTTY === true,
    managedStateExists: state.provisionerStateExists,
  });
  return await confirmDiscoveredInstallTarget(dependencies, options, discovery);
}

async function confirmDiscoveredInstallTarget(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  discovery: InstallTargetDiscovery,
): Promise<InstallTargetDiscovery> {
  if (discovery.kind === 'no-cluster') {
    renderMissingKubernetesCluster(dependencies);
    const shouldInstall: boolean =
      options.check === true || options.yes === true || (await promptManagedKubernetesInstall(dependencies.io));
    if (!shouldInstall) {
      throw new Error('Installation cancelled.');
    }
  }
  if (discovery.kind === 'unavailable-kubernetes') {
    await reportUnavailableKubernetesTarget(dependencies, discovery);
  }
  return discovery;
}

async function reportUnavailableKubernetesTarget(
  dependencies: CliCommandDependencies,
  discovery: Extract<InstallTargetDiscovery, { kind: 'unavailable-kubernetes' }>,
): Promise<never> {
  dependencies.io.stderr(`Checking Kubernetes\n  ✗ ${discovery.reason}\n`);
  if (discovery.kubeconfig.materializedDirectory !== undefined) {
    await rm(discovery.kubeconfig.materializedDirectory, { force: true, recursive: true });
  }
  throw new ReportedCliError(discovery.reason);
}

function renderMissingKubernetesCluster(dependencies: CliCommandDependencies): void {
  dependencies.io.stderr(`Checking Kubernetes
  No usable Kubernetes cluster detected.

Compartment requires:
  Kubernetes ${formatKubernetesVersionRequirement()} with the required APIs
  kubectl >= ${kubernetesInstallCompatibility.kubectlMinimumVersion}
  Helm >= ${kubernetesInstallCompatibility.helmMinimumVersion}

`);
}
