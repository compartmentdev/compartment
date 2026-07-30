import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import type { KubernetesInstallDeploymentInput } from './kubernetes-install.service.types';
import type {
  KubernetesNodeList,
  KubernetesNodeListItem,
  KubernetesNodeStatusCondition,
} from './kubernetes-ready-nodes.service.types';

export async function readReadyKubernetesNodeNames(input: KubernetesInstallDeploymentInput): Promise<string[]> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['get', 'nodes', '--output', 'json']),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure('Kubernetes node inventory failed', result));
  }
  try {
    const nodes: KubernetesNodeList = JSON.parse(result.stdout) as KubernetesNodeList;
    return nodes.items
      .filter(isEligibleNode)
      .map((node: KubernetesNodeListItem): string | undefined => node.metadata?.name)
      .filter((name: string | undefined): name is string => name !== undefined && name !== '');
  } catch {
    throw new Error('Kubernetes node inventory returned invalid JSON.');
  }
}

function isEligibleNode(node: KubernetesNodeListItem): boolean {
  return (
    node.spec?.unschedulable !== true &&
    node.status?.conditions?.some(
      (condition: KubernetesNodeStatusCondition): boolean => condition.type === 'Ready' && condition.status === 'True',
    ) === true
  );
}
