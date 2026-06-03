import { reconcileRuntimeNetworks, type RuntimeNetworkReconcileOptions } from './runtime-network.service';
import type { RuntimeConnectivityMode, RuntimeNetworkPoolConfig } from './runtime.types';

interface RuntimeNetworkReconcileConfig {
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
  runtimeNetworkPool: RuntimeNetworkPoolConfig;
}

export async function reconcileRuntimeNetworksAfterContainerRemovalBestEffort(
  config: RuntimeNetworkReconcileConfig,
): Promise<void> {
  await reconcileRuntimeNetworksBestEffort(config, {
    disconnectCaddyStaleNetworks: true,
  });
}

export async function reconcileRuntimeNetworksBestEffort(
  config: RuntimeNetworkReconcileConfig,
  options: RuntimeNetworkReconcileOptions = {},
): Promise<void> {
  try {
    await reconcileRuntimeNetworks(config, options);
  } catch {
    return;
  }
}
