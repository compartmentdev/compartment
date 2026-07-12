import {
  connectDockerContainerToNetwork,
  ensureDockerImageAvailable,
  inspectDockerContainer,
  removeDockerContainer,
  runDockerContainer,
  type DockerInspectContainerResult,
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
import { buildRuntimeDeploymentError, throwRuntimeStartupError } from './runtime-deploy-error.service';
import { waitForHealthyRuntimeFromDockerNetwork } from './runtime-docker-readiness.service';
import { isNodeRuntimeError } from '../errors/node-runtime-error';
import { syncRuntimeNetworkEgressDenyRules } from './runtime-network-egress.service';
import { resolveRuntimeNetworkActors, type RuntimeNetworkActors } from './runtime-network-actors.service';
import { normalizeRuntimeNetworkDockerError, type RuntimeNetworkErrorInput } from './runtime-network-error.service';
import { reconcileRuntimeNetworksBestEffort } from './runtime-network-reconcile.service';
import { buildDeploymentContainerName } from './runtime-names.service';
import {
  assertRuntimeResourceNetworkFreeEndpoints,
  ensureRuntimeResourceNetwork,
} from './runtime-network-capacity.service';
import { resolveRuntimeUpstreamTarget, type RuntimeUpstreamTarget } from './runtime-upstream-target.service';
import { buildRuntimeEnv, resolveRuntimeContainerPort } from './runtime-env.service';
import type { ResolvedRuntimeDeploymentContext, RuntimeDeployConfig } from './runtime.types';

const runtimeStartupStabilityDelayMs: number = 500;

export async function deployRuntimeContainer(
  input: NodeDeployRequest,
  config: RuntimeDeployConfig,
): Promise<NodeDeployResponse> {
  await ensureDockerImageAvailable({
    imageRef: input.imageRef,
    registryCredentials: config.runtimeRegistryCredentials,
  });
  const containerName: string = buildDeploymentContainerName(input, config.dockerNamespace);
  let context: ResolvedRuntimeDeploymentContext | undefined;
  try {
    await removeRuntimeContainerBestEffort(containerName);
    context = await resolveRuntimeDeploymentContext(input, config, containerName);
    const containerId: string = await runManagedContainer(input, context).catch(throwRuntimeStartupError);

    return await finalizePreparedRuntime(input, context, containerId, config);
  } catch (error) {
    if (context !== undefined) {
      await removeRuntimeContainerBestEffort(context.containerName);
    }
    await reconcileRuntimeNetworksBestEffort(config);
    throw normalizeRuntimeNetworkDockerError(error as RuntimeNetworkErrorInput, 'Unexpected runtime deployment error.');
  }
}

async function resolveRuntimeDeploymentContext(
  input: NodeDeployRequest,
  config: RuntimeDeployConfig,
  containerName: string,
): Promise<ResolvedRuntimeDeploymentContext> {
  const containerPort: number = await resolveRuntimeContainerPort(input.imageRef, input.runtimeEnv);
  const upstreamTarget: RuntimeUpstreamTarget = await resolveRuntimeUpstreamTarget(input, config, containerPort);

  return {
    containerName,
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
    return await handlePreparedRuntimeFailure(
      input,
      context,
      containerId,
      config,
      normalizeRuntimeNetworkDockerError(error as RuntimeNetworkErrorInput, 'Unexpected runtime deployment error.'),
    );
  }
}

async function handlePreparedRuntimeFailure(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
  containerId: string,
  config: RuntimeDeployConfig,
  runtimeError: Error,
): Promise<never> {
  const deploymentError: Error = await resolvePreparedRuntimeFailure(input, containerId, runtimeError);
  await removeRuntimeContainerBestEffort(context.containerName);
  await reconcileRuntimeNetworksBestEffort(config);
  throw deploymentError;
}

async function resolvePreparedRuntimeFailure(
  input: NodeDeployRequest,
  containerId: string,
  runtimeError: Error,
): Promise<Error> {
  return isNodeRuntimeError(runtimeError)
    ? runtimeError
    : await buildRuntimeDeploymentError(input, containerId, runtimeError);
}

async function verifyPreparedRuntimeHealth(
  input: NodeDeployRequest,
  context: ResolvedRuntimeDeploymentContext,
  containerId: string,
  config: RuntimeDeployConfig,
): Promise<void> {
  if (input.readiness === null) {
    await ensureRuntimeContainerStartupIsStable(containerId);
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
  if (!input.runtimeNetwork.requiresResourceNetwork) {
    return;
  }

  const networkName: string = await ensureRuntimeResourceNetwork(input, config);
  await assertRuntimeResourceNetworkFreeEndpoints(
    input,
    config,
    1,
    'connecting deployment container to resource network',
  );
  const platformSourceContainerRefs: string[] = await readPreparedRuntimePlatformSourceContainerRefs(context, config);
  await syncRuntimeNetworkEgressDenyRules({
    dockerNamespace: config.dockerNamespace,
    networkNames: buildPreparedRuntimeEgressDenyNetworkNames(context, networkName),
    platformSourceContainerRefs,
  });
  await connectDockerContainerToNetwork({ containerRef: context.containerName, networkName });
}

async function readPreparedRuntimePlatformSourceContainerRefs(
  context: ResolvedRuntimeDeploymentContext,
  config: RuntimeDeployConfig,
): Promise<string[]> {
  if (context.networkName === undefined) {
    return [];
  }

  const actors: RuntimeNetworkActors = await resolveRuntimeNetworkActors(config);
  return [actors.caddyContainerId];
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

async function ensureRuntimeContainerStartupIsStable(containerId: string): Promise<void> {
  await ensureRuntimeContainerIsRunning(containerId);
  await waitForRuntimeStartupStability();
  await ensureRuntimeContainerIsRunning(containerId);
}

async function ensureRuntimeContainerIsRunning(containerId: string): Promise<void> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({
    containerRef: containerId,
  });
  if (container?.isRunning !== true) {
    throw new Error(`Expected runtime container ${containerId} to remain running after startup.`);
  }
}

async function waitForRuntimeStartupStability(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, runtimeStartupStabilityDelayMs);
  });
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
