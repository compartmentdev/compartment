import { listDockerContainers, type DockerListContainerResult } from '@compartment/docker';
import type { RuntimeConnectivityMode } from './runtime.types';

const dockerComposeProjectLabelName: string = 'com.docker.compose.project';
const dockerComposeServiceLabelName: string = 'com.docker.compose.service';

export interface RuntimeNetworkActors {
  readonly caddyContainerId: string;
}

interface RuntimeNetworkActorConfig {
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
}

export async function resolveRuntimeNetworkActors(config: RuntimeNetworkActorConfig): Promise<RuntimeNetworkActors> {
  const caddyContainers: DockerListContainerResult[] = await listDockerContainers({
    labelFilters: {
      [dockerComposeProjectLabelName]: config.dockerNamespace,
      [dockerComposeServiceLabelName]: 'caddy',
    },
  });
  const caddyContainerId: string | undefined = caddyContainers[0]?.containerId;
  if (caddyContainers.length !== 1 || caddyContainerId === undefined) {
    throw new Error(`Expected one running caddy container for docker namespace ${config.dockerNamespace}.`);
  }

  return {
    caddyContainerId,
  };
}
