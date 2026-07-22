import type { CommandResult } from '../command-runner.types';

interface KubernetesCommandTarget {
  kubeconfigPath?: string | undefined;
  kubeContext?: string | undefined;
  namespace: string;
}

export function buildHelmKubeContextArgs(target: KubernetesCommandTarget): string[] {
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

export function readCommandOutput(result: CommandResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n');
}
