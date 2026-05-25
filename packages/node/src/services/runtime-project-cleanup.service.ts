import {
  compartmentDockerNamespaceLabelName,
  listDockerContainers,
  listDockerVolumes,
  removeDockerContainer,
  removeDockerVolume,
  type DockerListContainerResult,
  type DockerListVolumeResult,
} from '@compartment/docker';
import type { NodeProjectCleanupRequest, NodeProjectCleanupResponse, NodeResourceVolume } from '@compartment/contracts';
import { projectIdLabelName } from './runtime-container-labels';
import { reconcileRuntimeNetworks } from './runtime-network.service';
import { buildResourceVolumeName } from './runtime-names.service';
import type { RuntimeDeployConfig } from './runtime.types';

type DeferredCaddyNetworkReconcileTimer = NodeJS.Timeout;

const deferredCaddyNetworkReconcileDelayMs: number = 2_000;
const deferredCaddyNetworkReconcileTimers: Map<string, DeferredCaddyNetworkReconcileTimer> = new Map<
  string,
  DeferredCaddyNetworkReconcileTimer
>();

export async function cleanupRuntimeProject(
  input: NodeProjectCleanupRequest,
  config: RuntimeDeployConfig,
): Promise<NodeProjectCleanupResponse> {
  await removeProjectRuntimeContainers(input, config);
  if (input.deleteData) {
    await removeProjectResourceVolumes(input, config);
  }
  const disconnectCaddyStaleNetworks: boolean = input.caddyNetworkMode === 'disconnect-stale';
  await reconcileRuntimeNetworks(config, { disconnectCaddyStaleNetworks });
  if (!disconnectCaddyStaleNetworks) {
    scheduleDeferredCaddyNetworkReconcile(config);
  }

  return {
    cleanedAt: new Date().toISOString(),
  };
}

function scheduleDeferredCaddyNetworkReconcile(config: RuntimeDeployConfig): void {
  // Docker network detaches on the shared Caddy container can reset in-flight control-plane HTTPS requests.
  const existingTimer: DeferredCaddyNetworkReconcileTimer | undefined = deferredCaddyNetworkReconcileTimers.get(
    config.dockerNamespace,
  );
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  const timer: DeferredCaddyNetworkReconcileTimer = setTimeout((): void => {
    deferredCaddyNetworkReconcileTimers.delete(config.dockerNamespace);
    void reconcileRuntimeNetworks(config, { disconnectCaddyStaleNetworks: true }).catch((): void => undefined);
  }, deferredCaddyNetworkReconcileDelayMs);
  timer.unref();
  deferredCaddyNetworkReconcileTimers.set(config.dockerNamespace, timer);
}

async function removeProjectRuntimeContainers(
  input: NodeProjectCleanupRequest,
  config: RuntimeDeployConfig,
): Promise<void> {
  const containers: DockerListContainerResult[] = await listDockerContainers({
    all: true,
    labelFilters: {
      [compartmentDockerNamespaceLabelName]: config.dockerNamespace,
      [projectIdLabelName]: input.projectId,
    },
  });

  for (const container of containers) {
    await removeDockerContainer({ containerRef: container.containerId });
  }
}

async function removeProjectResourceVolumes(
  input: NodeProjectCleanupRequest,
  config: RuntimeDeployConfig,
): Promise<void> {
  await removeProjectLabeledResourceVolumes(input, config);
  for (const resource of input.resources) {
    for (const volume of resource.volumes) {
      await removeDockerVolume({
        volumeName: buildProjectResourceVolumeName(
          input.projectName,
          resource.environmentName,
          resource.resourceName,
          volume,
          config,
        ),
      });
    }
  }
}

async function removeProjectLabeledResourceVolumes(
  input: NodeProjectCleanupRequest,
  config: RuntimeDeployConfig,
): Promise<void> {
  const volumes: DockerListVolumeResult[] = await listDockerVolumes({
    labelFilters: {
      [compartmentDockerNamespaceLabelName]: config.dockerNamespace,
      [projectIdLabelName]: input.projectId,
    },
  });

  for (const volume of volumes) {
    await removeDockerVolume({ volumeName: volume.name });
  }
}

function buildProjectResourceVolumeName(
  projectName: string,
  environmentName: string,
  resourceName: string,
  volume: NodeResourceVolume,
  config: RuntimeDeployConfig,
): string {
  return buildResourceVolumeName(
    {
      environmentName,
      projectName,
      resourceName,
    },
    config.dockerNamespace,
    volume.name,
  );
}
