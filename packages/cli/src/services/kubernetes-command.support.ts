import type { CommandResult } from '../command-runner.types';

interface HelmCommandTarget {
  kubeconfigPath?: string | undefined;
  kubeContext?: string | undefined;
}

interface KubernetesCommandTarget extends HelmCommandTarget {
  namespace: string;
}

export function buildHelmGetValuesCommand(
  target: KubernetesCommandTarget,
  releaseName: string,
  args: readonly string[],
): string[] {
  return buildHelmCommand(target, ['get', 'values', releaseName, '--namespace', target.namespace, ...args]);
}

export function buildHelmUpgradeCommand(
  target: KubernetesCommandTarget,
  releaseName: string,
  chartPath: string,
  args: readonly string[],
): string[] {
  return buildHelmCommand(target, ['upgrade', releaseName, chartPath, '--namespace', target.namespace, ...args]);
}

export function buildHelmCommand(target: HelmCommandTarget, args: readonly string[]): string[] {
  return ['helm', ...args, ...buildHelmKubeContextArgs(target)];
}

function buildHelmKubeContextArgs(target: HelmCommandTarget): string[] {
  return [
    ...(target.kubeconfigPath === undefined ? [] : ['--kubeconfig', target.kubeconfigPath]),
    ...(target.kubeContext === undefined ? [] : ['--kube-context', target.kubeContext]),
  ];
}

export function buildKubectlCommand(target: KubernetesCommandTarget, args: readonly string[]): string[] {
  return [
    'kubectl',
    ...(target.kubeconfigPath === undefined ? [] : ['--kubeconfig', target.kubeconfigPath]),
    ...(target.kubeContext === undefined ? [] : ['--context', target.kubeContext]),
    '--namespace',
    target.namespace,
    ...args,
  ];
}

export function buildKubernetesReleaseSelector(releaseName: string): string {
  return `app.kubernetes.io/instance=${releaseName}`;
}

export function formatKubernetesCommandFailure(message: string, result: CommandResult): string {
  const output: string = readCommandOutput(result);
  const status: string =
    result.exitCode === 124 ? 'command timed out' : `command exited with status ${result.exitCode.toString()}`;
  return `${message} (${status}): ${output === '' ? 'the command produced no diagnostics' : output}`;
}

export function readCommandOutput(result: CommandResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n');
}
