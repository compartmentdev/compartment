import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { KubernetesInstallKubeconfigResolutionError } from './kubernetes-install-kubeconfig.error';
import { resolveKubernetesInstallKubeconfig } from './kubernetes-install-kubeconfig.service';
import type { ResolvedKubernetesKubeconfig } from './kubernetes-install-kubeconfig.service.types';
import { formatMissingKubernetesInstallTool } from './kubernetes-install-local-tools.service';
import type { InstallTargetDiscovery, InstallTargetSelectionInput } from './managed-vm-target.service.types';

export type { InstallTargetDiscovery } from './managed-vm-target.service.types';

export async function selectInstallTarget(input: InstallTargetSelectionInput): Promise<InstallTargetDiscovery> {
  if (input.explicitTarget !== undefined) {
    return { kind: 'explicit', target: input.explicitTarget };
  }
  if (!input.interactive) {
    throw new Error('--target vm|kubernetes is required without an interactive terminal.');
  }
  if (input.managedStateExists) {
    return { kind: 'managed-resume', target: 'vm' };
  }
  return await discoverKubernetesTarget(input);
}

async function discoverKubernetesTarget(input: InstallTargetSelectionInput): Promise<InstallTargetDiscovery> {
  const kubeconfig: ResolvedKubernetesKubeconfig | InstallTargetDiscovery = await resolveDiscoveredKubeconfig(input);
  if ('kind' in kubeconfig) {
    return kubeconfig;
  }
  const reachable: CommandResult = await checkDiscoveredKubernetesAccess(kubeconfig);
  const reason: string | undefined = readUnusableClusterReason(reachable, kubeconfig);
  return reason === undefined
    ? { kind: 'kubernetes', kubeconfig, target: 'kubernetes' }
    : { kind: 'unavailable-kubernetes', kubeconfig, reason, target: 'kubernetes' };
}

async function resolveDiscoveredKubeconfig(
  input: InstallTargetSelectionInput,
): Promise<ResolvedKubernetesKubeconfig | InstallTargetDiscovery> {
  let kubeconfig: ResolvedKubernetesKubeconfig;
  try {
    kubeconfig = await resolveKubernetesInstallKubeconfig({
      ...(input.contextName === undefined ? {} : { contextName: input.contextName }),
      env: input.env,
      homeDirectory: input.homeDirectory,
    });
  } catch (error) {
    if (error instanceof KubernetesInstallKubeconfigResolutionError && error.reason === 'no-usable-cluster') {
      return { kind: 'no-cluster', target: 'vm' };
    }
    throw error;
  }
  return kubeconfig;
}

async function checkDiscoveredKubernetesAccess(kubeconfig: ResolvedKubernetesKubeconfig): Promise<CommandResult> {
  return await runCommand([
    'kubectl',
    '--kubeconfig',
    kubeconfig.path,
    '--context',
    kubeconfig.contextName,
    '--request-timeout=5s',
    'auth',
    'can-i',
    'get',
    'namespaces',
  ]);
}

function readUnusableClusterReason(
  result: CommandResult,
  kubeconfig: ResolvedKubernetesKubeconfig,
): string | undefined {
  if (result.failure?.kind === 'command-not-found') {
    return formatMissingKubernetesInstallTool('kubectl');
  }
  if (result.exitCode !== 0) {
    return `Cannot reach Kubernetes cluster "${kubeconfig.contextName}" at ${kubeconfig.clusterServer}.`;
  }
  return result.stdout.trim() === 'yes'
    ? undefined
    : `Kubernetes identity for context "${kubeconfig.contextName}" cannot get namespaces.`;
}
