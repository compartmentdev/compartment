import type { NodeDeployRequest } from '@compartment/contracts';
import { buildDeploymentUpstreamHost } from './runtime-names.service';
import { ensureRuntimeNetworkForDeployment } from './runtime-network.service';
import { loopbackRuntimePublishHost } from './runtime-publish.constants';
import { findAvailablePort } from './runtime-port.service';
import type { RuntimeDeployConfig } from './runtime.types';

export interface RuntimeUpstreamTarget {
  networkAliases?: string[] | undefined;
  networkName?: string | undefined;
  publishedPort?: number | undefined;
  upstreamHost: string;
  upstreamPort: number;
}

export async function resolveRuntimeUpstreamTarget(
  input: NodeDeployRequest,
  config: RuntimeDeployConfig,
  containerPort: number,
): Promise<RuntimeUpstreamTarget> {
  const upstreamHost: string = buildDeploymentUpstreamHost(input, config.dockerNamespace);
  if (config.runtimeConnectivityMode === 'network') {
    const networkName: string = await ensureRuntimeNetworkForDeployment(config, input);
    return {
      networkAliases: [upstreamHost],
      networkName,
      upstreamHost,
      upstreamPort: containerPort,
    };
  }

  const upstreamPort: number = await findAvailableRuntimeRoutePort(input, config);
  return {
    publishedPort: upstreamPort,
    upstreamHost: config.runtimeDefaultUpstreamHost,
    upstreamPort,
  };
}

async function findAvailableRuntimeRoutePort(input: NodeDeployRequest, config: RuntimeDeployConfig): Promise<number> {
  return await findAvailablePort(
    config.appPortStart,
    config.appPortEnd,
    input.previousDeployment !== undefined ? [input.previousDeployment.upstreamPort] : [],
    loopbackRuntimePublishHost,
  );
}
