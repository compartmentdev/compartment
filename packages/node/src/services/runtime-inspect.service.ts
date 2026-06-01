import {
  readNodeInspectReadiness,
  type NodeInspectDeploymentQuery,
  type NodeInspectDeploymentResponse,
  type NodeInspectedDeployment,
  type ResolvedServiceReadinessConfig,
} from '@compartment/contracts';
import {
  inspectDockerContainer,
  type DockerInspectContainerResult,
  type DockerNetworkAttachment,
} from '@compartment/docker';
import { hasText } from '@compartment/utils';
import { waitForHealthyRuntimeFromDockerNetwork } from './runtime-docker-readiness.service';
import { waitForHealthyRuntime } from './runtime-health.service';
import {
  deploymentIdLabelName,
  environmentIdLabelName,
  projectIdLabelName,
  routeHostLabelName,
  serviceIdLabelName,
  upstreamHostLabelName,
  upstreamPortLabelName,
} from './runtime-container-labels';
import {
  buildDeploymentContainerName,
  buildDeploymentUpstreamHost,
  buildRuntimeServiceNetworkName,
} from './runtime-names.service';
import { assertInspectableRuntimeNetwork } from './runtime-inspect-network.service';
import type { RuntimeConnectivityMode, RuntimeNetworkPoolConfig } from './runtime.types';

interface HostInspectableReadinessTarget {
  host: string;
  type: 'host';
}

interface DockerNetworkInspectableReadinessTarget {
  networkName: string;
  type: 'docker-network';
}

type InspectableReadinessTarget = DockerNetworkInspectableReadinessTarget | HostInspectableReadinessTarget;

interface RuntimeInspectConfig {
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
  runtimeNetworkPool: RuntimeNetworkPoolConfig;
  runtimeProbeImageRef: string;
}

export async function inspectRuntimeDeployment(
  input: NodeInspectDeploymentQuery,
  config: RuntimeInspectConfig,
): Promise<NodeInspectDeploymentResponse> {
  const container: DockerInspectContainerResult | null = await inspectRuntimeContainer(input, config.dockerNamespace);
  if (container === null || !container.isRunning || !matchesDeployment(container, input.deploymentId)) {
    return { deployment: null };
  }
  const deployment: NodeInspectedDeployment | null = buildInspectedDeployment(container);
  if (deployment === null) {
    return { deployment: null };
  }
  if (!(await isInspectableDeploymentReady(container, deployment, input, config))) {
    return { deployment: null };
  }

  return {
    deployment,
  };
}

async function inspectRuntimeContainer(
  input: NodeInspectDeploymentQuery,
  dockerNamespace: string,
): Promise<DockerInspectContainerResult | null> {
  return await inspectDockerContainer({
    containerRef: buildDeploymentContainerName(input, dockerNamespace),
  });
}

function matchesDeployment(container: DockerInspectContainerResult, deploymentId: string): boolean {
  return container.labels[deploymentIdLabelName] === deploymentId;
}

function buildInspectedDeployment(container: DockerInspectContainerResult): NodeInspectedDeployment | null {
  const routeHost: string | undefined = container.labels[routeHostLabelName];
  const upstreamHost: string | null = readLabeledUpstreamHost(container.labels[upstreamHostLabelName]);
  const upstreamPort: number | null = readUpstreamPort(container);
  if (routeHost === undefined || upstreamHost === null || upstreamPort === null) {
    return null;
  }

  return {
    containerId: container.containerId,
    imageRef: container.imageRef,
    routeHost,
    upstreamHost,
    upstreamPort,
  };
}

async function isInspectableDeploymentReady(
  container: DockerInspectContainerResult,
  deployment: NodeInspectedDeployment,
  query: NodeInspectDeploymentQuery,
  config: RuntimeInspectConfig,
): Promise<boolean> {
  const readiness: ResolvedServiceReadinessConfig | null = readNodeInspectReadiness(query);
  if (readiness === null) {
    return true;
  }

  return await canReachInspectableDeployment(container, deployment, query, readiness, config);
}

async function canReachInspectableDeployment(
  container: DockerInspectContainerResult,
  deployment: NodeInspectedDeployment,
  query: NodeInspectDeploymentQuery,
  readiness: ResolvedServiceReadinessConfig,
  config: RuntimeInspectConfig,
): Promise<boolean> {
  try {
    const readinessTarget: InspectableReadinessTarget | null = readInspectableReadinessTarget(
      container,
      deployment,
      query,
      config,
    );
    if (readinessTarget === null) {
      return false;
    }

    await waitForInspectableDeploymentReadiness(readinessTarget, container, deployment, readiness, config);
    return true;
  } catch {
    return false;
  }
}

async function waitForInspectableDeploymentReadiness(
  target: InspectableReadinessTarget,
  container: DockerInspectContainerResult,
  deployment: NodeInspectedDeployment,
  readiness: ResolvedServiceReadinessConfig,
  config: RuntimeInspectConfig,
): Promise<void> {
  if (target.type === 'host') {
    await waitForHostInspectableDeploymentReadiness(target, deployment, readiness);
    return;
  }

  await waitForDockerNetworkInspectableDeploymentReadiness(target, container, deployment, readiness, config);
}

async function waitForHostInspectableDeploymentReadiness(
  target: HostInspectableReadinessTarget,
  deployment: NodeInspectedDeployment,
  readiness: ResolvedServiceReadinessConfig,
): Promise<void> {
  await waitForHealthyRuntime(target.host, deployment.upstreamPort, readiness, {
    hostHeader: deployment.upstreamHost,
  });
}

async function waitForDockerNetworkInspectableDeploymentReadiness(
  target: DockerNetworkInspectableReadinessTarget,
  container: DockerInspectContainerResult,
  deployment: NodeInspectedDeployment,
  readiness: ResolvedServiceReadinessConfig,
  config: RuntimeInspectConfig,
): Promise<void> {
  await assertInspectableRuntimeNetwork(target.networkName, container, config);
  await waitForHealthyRuntimeFromDockerNetwork({
    dockerNamespace: config.dockerNamespace,
    host: deployment.upstreamHost,
    hostHeader: deployment.upstreamHost,
    networkName: target.networkName,
    port: deployment.upstreamPort,
    probeImageRef: config.runtimeProbeImageRef,
    readiness,
  });
}

function readInspectableReadinessTarget(
  container: DockerInspectContainerResult,
  deployment: NodeInspectedDeployment,
  query: NodeInspectDeploymentQuery,
  config: RuntimeInspectConfig,
): InspectableReadinessTarget | null {
  if (config.runtimeConnectivityMode === 'loopback') {
    return { host: deployment.upstreamHost, type: 'host' };
  }

  if (deployment.upstreamHost !== buildDeploymentUpstreamHost(query, config.dockerNamespace)) {
    return null;
  }

  const networkName: string | null = readInspectableRuntimeNetworkName(container, config.dockerNamespace);
  return networkName === null ? null : { networkName, type: 'docker-network' };
}

function readInspectableRuntimeNetworkName(
  container: DockerInspectContainerResult,
  dockerNamespace: string,
): string | null {
  const expectedNetworkName: string | null = readExpectedRuntimeServiceNetworkName(container, dockerNamespace);
  if (expectedNetworkName !== null && hasNetworkAttachment(container, expectedNetworkName)) {
    return expectedNetworkName;
  }

  return null;
}

function readExpectedRuntimeServiceNetworkName(
  container: DockerInspectContainerResult,
  dockerNamespace: string,
): string | null {
  const environmentId: string | undefined = container.labels[environmentIdLabelName];
  const projectId: string | undefined = container.labels[projectIdLabelName];
  const serviceId: string | undefined = container.labels[serviceIdLabelName];
  if (!hasText(environmentId) || !hasText(projectId) || !hasText(serviceId)) {
    return null;
  }

  return buildRuntimeServiceNetworkName({ environmentId, projectId, serviceId }, dockerNamespace);
}

function hasNetworkAttachment(container: DockerInspectContainerResult, networkName: string): boolean {
  return (
    container.networkAttachments?.some(
      (networkAttachment: DockerNetworkAttachment): boolean => networkAttachment.name === networkName,
    ) ?? false
  );
}

function readUpstreamPort(container: DockerInspectContainerResult): number | null {
  return readLabeledUpstreamPort(container.labels[upstreamPortLabelName]);
}

function readLabeledUpstreamHost(value: string | undefined): string | null {
  return hasText(value) ? value : null;
}

function readLabeledUpstreamPort(value: string | undefined): number | null {
  if (!hasText(value)) {
    return null;
  }

  const upstreamPort: number = Number.parseInt(value, 10);
  return Number.isInteger(upstreamPort) && upstreamPort > 0 ? upstreamPort : null;
}
