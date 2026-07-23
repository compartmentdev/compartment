import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolveKubernetesInstallKubeconfig } from './kubernetes-install-kubeconfig.service';
import type { ResolvedKubernetesKubeconfig } from './kubernetes-install-kubeconfig.service.types';
import type { KubernetesOperatorTarget, KubernetesOperatorTargetAction } from './kubernetes-operator.service.types';

export async function withResolvedKubernetesOperatorTarget<Result>(
  target: KubernetesOperatorTarget,
  action: KubernetesOperatorTargetAction<Result>,
): Promise<Result> {
  const kubeconfig: ResolvedKubernetesKubeconfig = await resolveKubernetesInstallKubeconfig({
    ...(target.kubeContext === undefined ? {} : { contextName: target.kubeContext }),
    env: process.env,
    homeDirectory: homedir(),
  });
  try {
    return await action({
      ...target,
      kubeContext: kubeconfig.contextName,
      kubeconfigPath: kubeconfig.path,
    });
  } finally {
    if (kubeconfig.materializedDirectory !== undefined) {
      await rm(kubeconfig.materializedDirectory, { force: true, recursive: true });
    }
  }
}
