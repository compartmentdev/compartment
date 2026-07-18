import type { CommandResult } from '../command-runner.types';

interface KubernetesCommandTarget {
  kubeContext?: string | undefined;
  namespace: string;
}

export function buildHelmKubeContextArgs(target: KubernetesCommandTarget): string[] {
  return target.kubeContext === undefined ? [] : ['--kube-context', target.kubeContext];
}

export function buildKubectlCommand(target: KubernetesCommandTarget, args: readonly string[]): string[] {
  return [
    'kubectl',
    ...(target.kubeContext === undefined ? [] : ['--context', target.kubeContext]),
    '--namespace',
    target.namespace,
    ...args,
  ];
}

export function readCommandOutput(result: CommandResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n');
}
