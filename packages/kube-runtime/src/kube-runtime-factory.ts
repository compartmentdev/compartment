import { KubeConfig } from '@kubernetes/client-node';
import { ClientNodeKubeLeaseTransport } from './kube-lease-transport';
import { KubeLeaderElection } from './kube-leader-election';
import type {
  KubeLeaderElectionCallbacks,
  KubeLeaderElectionConfig,
  KubeLeaderElector,
} from './kube-leader-election.types';
import { KubeRuntime } from './kube-runtime';

export function createKubeRuntimeFromEnvironment(env: NodeJS.ProcessEnv = process.env): KubeRuntime {
  return new KubeRuntime(loadKubeConfig(env));
}

export function createSelfCleaningKubeRuntimeFromEnvironment(env: NodeJS.ProcessEnv = process.env): KubeRuntime {
  const kubeConfig: KubeConfig = loadKubeConfig(env);
  return new KubeRuntime(kubeConfig, kubeConfig);
}

export function createKubeLeaderElectionFromEnvironment(
  config: KubeLeaderElectionConfig,
  callbacks: KubeLeaderElectionCallbacks,
  env: NodeJS.ProcessEnv = process.env,
): KubeLeaderElector {
  return new KubeLeaderElection(new ClientNodeKubeLeaseTransport(loadKubeConfig(env)), config, callbacks);
}

function loadKubeConfig(env: NodeJS.ProcessEnv): KubeConfig {
  const kubeConfig: KubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromCluster();
  } catch (clusterError) {
    const kubeconfigPath: string | undefined = env.KUBECONFIG;
    if (kubeconfigPath === undefined || kubeconfigPath.trim() === '') {
      throw clusterError;
    }
    kubeConfig.loadFromFile(kubeconfigPath);
  }
  return kubeConfig;
}
