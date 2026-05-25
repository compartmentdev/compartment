import {
  connectDockerContainerToNetwork,
  ensureDockerImageAvailable,
  inspectDockerContainer,
  removeDockerContainer,
  runDockerContainer,
  tailDockerContainerLogs,
  type DockerInspectContainerResult,
  type DockerLogLine,
  type DockerRunContainerInput,
  type DockerRunContainerResult,
} from '@compartment/docker';
import type {
  NodeDeployRequest,
  NodeDeployResponse,
  ResolvedCompartmentServiceRunConfig,
} from '@compartment/contracts';
import { waitForHealthyRuntime } from './runtime-health.service';
import { buildRuntimeContainerInput } from './runtime-container-input.service';
import { waitForHealthyRuntimeFromDockerNetwork } from './runtime-docker-readiness.service';
import { syncRuntimeNetworkEgressDenyRules } from './runtime-network-egress.service';
import { resolveRuntimeNetworkActors, type RuntimeNetworkActors } from './runtime-network.service';
import { ensureOwnedRuntimeNetwork } from './runtime-network-ownership.service';
import { reconcileRuntimeNetworksBestEffort } from './runtime-network-reconcile.service';
import { buildDeploymentContainerName, buildRuntimeResourceNetworkName } from './runtime-names.service';
import { resolveRuntimeUpstreamTarget, type RuntimeUpstreamTarget } from './runtime-upstream-target.service';
import { buildRuntimeEnv, resolveRuntimeContainerPort } from './runtime-env.service';
import type { ResolvedRuntimeDeploymentContext, RuntimeDeployConfig } from './runtime.types';

export async function deployRuntimeContainer(
  input: NodeDeployRequest,
  config: RuntimeDeployConfig,
): Promise<NodeDeployResponse> {
  await ensureDockerImageAvailable({
    imageRef: input.imageRef,
    registryCredentials: config.runtimeRegistryCredentials,
  });
  const context: ResolvedRuntimeDeploymentContext = await resolveRuntimeDeploymentContext(input, config);
  const containerId: string = await runManagedContainer(input, context);

  return await finalizePreparedRuntime(input, context, containerId, config);
}

async function resolveRuntimeDeploymentContext(
  input: NodeDeployRequest,
  config: RuntimeDeployConfig,
): Promise<ResolvedRuntimeDeploymentContext> {
  const containerPort: number = await resolveRuntimeContainerPort(input.imageRef, input.runtimeEnv);
  const upstreamTarget: RuntimeUpstreamTarget = await resolveRuntimeUpstreamTarget(input, config, containerPort);

  return {
    containerName: buildDeploymentContainerName(input, config.dockerNamespace),
    containerPort,
    dockerNamespace: config.dockerNamespace,
    networkAliases: upstreamTarget.networkAliases,
    networkName: upstreamTarget.networkName,
    publishedPort: upstreamTarget.publishedPort,
    upstreamHost: upstreamTarget.upstreamHost,
    upstreamPort: upstreamTarget.upstreamPort,
    ...(input.run.command !== undefined ? { runtimeCommand: buildRuntimeCommand(input.run) } : {}),
    runtimeEnv: buildRuntimeEnv(input.runtimeEnv, containerPort),
  };
}

function buildRuntimeCommand(run: ResolvedCompartmentServiceRunConfig): string[] {
  const command: string | undefined = run.command;
  if (command === undefined) {
    throw new Error('Expected a resolved runtime command override.');
  }

  return [command];
}

async function finalizePreparedRuntime(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
  containerId: string,
  config: RuntimeDeployConfig,
): Promise<NodeDeployResponse> {
  try {
    await connectPreparedRuntimeResourceNetwork(input, context, config);
    await verifyPreparedRuntimeHealth(input, context, containerId, config);
    return createPreparedRuntimeResponse(input, context, containerId);
  } catch (error) {
    const runtimeError: Error = error instanceof Error ? error : new Error('Unexpected runtime deployment error.');
    const deploymentError: Error = await buildRuntimeDeploymentError(input, containerId, runtimeError);
    await removeRuntimeContainerBestEffort(context.containerName);
    await reconcileRuntimeNetworksBestEffort(config);
    throw deploymentError;
  }
}

async function verifyPreparedRuntimeHealth(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
  containerId: string,
  config: RuntimeDeployConfig,
): Promise<void> {
  if (input.readiness === null) {
    await ensureRuntimeContainerIsRunning(containerId);
    return;
  }

  const networkName: string | undefined = context.networkName;
  if (networkName === undefined) {
    await waitForHealthyRuntime(context.upstreamHost, context.upstreamPort, input.readiness);
    return;
  }

  await waitForHealthyRuntimeFromDockerNetwork({
    dockerNamespace: context.dockerNamespace,
    host: context.upstreamHost,
    hostHeader: context.upstreamHost,
    networkName,
    port: context.upstreamPort,
    probeImageRef: config.runtimeProbeImageRef,
    readiness: input.readiness,
  });
}

async function connectPreparedRuntimeResourceNetwork(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
  config: RuntimeDeployConfig,
): Promise<void> {
  const networkName: string = buildRuntimeResourceNetworkName(input, config.dockerNamespace);
  await ensureOwnedRuntimeNetwork({ dockerNamespace: config.dockerNamespace, networkName });
  const platformSourceContainerRefs: string[] = [];
  if (context.networkName !== undefined) {
    const actors: RuntimeNetworkActors = await resolveRuntimeNetworkActors(config);
    platformSourceContainerRefs.push(actors.caddyContainerId);
  }
  await syncRuntimeNetworkEgressDenyRules({
    dockerNamespace: config.dockerNamespace,
    networkNames: buildPreparedRuntimeEgressDenyNetworkNames(context, networkName),
    platformSourceContainerRefs,
  });
  await connectDockerContainerToNetwork({ containerRef: context.containerName, networkName });
}

function buildPreparedRuntimeEgressDenyNetworkNames(
  context: ResolvedRuntimeDeploymentContext,
  resourceNetworkName: string,
): string[] {
  return context.networkName === undefined ? [resourceNetworkName] : [context.networkName, resourceNetworkName];
}

function createPreparedRuntimeResponse(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
  containerId: string,
): NodeDeployResponse {
  return {
    containerId,
    imageRef: input.imageRef,
    routeHost: input.routeHost,
    upstreamHost: context.upstreamHost,
    upstreamPort: context.upstreamPort,
    startedAt: new Date().toISOString(),
  };
}

async function ensureRuntimeContainerIsRunning(containerId: string): Promise<void> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({
    containerRef: containerId,
  });
  if (container?.isRunning !== true) {
    throw new Error(`Expected runtime container ${containerId} to remain running after startup.`);
  }
}

async function runManagedContainer(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
): Promise<string> {
  await removeDockerContainer({ containerRef: context.containerName });
  const runtimeContainerInput: DockerRunContainerInput = buildRuntimeContainerInput(input, context);
  const container: DockerRunContainerResult = await runDockerContainer(runtimeContainerInput);

  return container.containerId;
}

async function removeRuntimeContainerBestEffort(containerRef: string): Promise<void> {
  try {
    await removeDockerContainer({ containerRef });
  } catch {
    return;
  }
}

async function buildRuntimeDeploymentError(
  input: NodeDeployRequest,
  containerId: string,
  error: Error,
): Promise<Error> {
  const summary: string = input.readiness === null ? 'runtime startup failed' : 'runtime readiness failed';
  const detail: string = error.message;
  const logs: string = await readRuntimeFailureLogs(containerId);

  return new Error(logs === '' ? `${summary}: ${detail}` : `${summary}: ${detail}\nLast logs:\n${logs}`);
}

async function readRuntimeFailureLogs(containerId: string): Promise<string> {
  try {
    const lines: DockerLogLine[] = (await tailDockerContainerLogs({ containerId, tailLines: 50 })).lines;
    return lines
      .map((line: DockerLogLine): string => `[${line.stream}] ${line.message}`)
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}
