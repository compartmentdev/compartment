import { KubeConfig } from '@kubernetes/client-node';
import { KubeRuntime } from './kube-runtime';

export function createKubeRuntimeFromEnvironment(env: NodeJS.ProcessEnv = process.env): KubeRuntime {
  const kubeConfig: KubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromCluster();
  } catch (clusterError) {
    const kubeconfigPath: string | undefined = env.KUBECONFIG;
    if (kubeconfigPath === undefined || kubeconfigPath.trim() === '') throw clusterError;
    kubeConfig.loadFromFile(kubeconfigPath);
  }
  return new KubeRuntime(kubeConfig);
}
