import { inspectDockerContainer, type DockerInspectContainerResult } from '@compartment/docker';
import type { NodeResourceReadiness, NodeResourceRequest } from '@compartment/contracts';
import { createRuntimeResourceReadinessError } from '../errors/node-runtime-error';
import { buildRuntimeResourceNetworkName } from './runtime-names.service';
import { canConnectToRuntimeHost } from './runtime-resource-connectivity.service';
import { continueResourceReadinessPolling, resolveResourceReadinessHost } from './runtime-resource-readiness.service';
import { removeRuntimeResourceContainerBestEffort } from './runtime-resource-cleanup.service';
import type { RuntimeDeployConfig } from './runtime.types';

export async function waitForResourceStartupReadiness(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
  containerId: string,
): Promise<void> {
  if (input.definition.readiness === null) {
    await ensureResourceContainerIsRunning(containerId);
    return;
  }

  const readiness: NodeResourceReadiness = input.definition.readiness;
  const deadline: number = Date.now() + readiness.timeoutMs;
  for (;;) {
    if (await canReachRuntimeResourceReadiness(input, config, containerId, readiness.port, deadline)) {
      return;
    }
    if (!(await continueResourceReadinessPolling(deadline))) {
      break;
    }
  }

  await throwResourceStartupReadinessError(input, containerId, readiness);
}

async function throwResourceStartupReadinessError(
  input: NodeResourceRequest,
  containerId: string,
  readiness: NodeResourceReadiness,
): Promise<never> {
  await removeRuntimeResourceContainerBestEffort(containerId);
  throw createRuntimeResourceReadinessError({
    phase: 'startup',
    resourceName: input.resourceName,
    timeoutMs: readiness.timeoutMs,
  });
}

async function canReachRuntimeResourceReadiness(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
  containerId: string,
  port: number,
  deadline: number,
): Promise<boolean> {
  const resourceNetworkName: string = buildRuntimeResourceNetworkName(input, config.dockerNamespace);
  return await canReachResourceReadinessPort(containerId, resourceNetworkName, port, deadline);
}

async function canReachResourceReadinessPort(
  containerId: string,
  resourceNetworkName: string,
  port: number,
  deadline: number,
): Promise<boolean> {
  const readinessHost: string | null = await resolveReadinessHost(containerId, resourceNetworkName);
  return readinessHost !== null && (await canConnectToRuntimeHost(readinessHost, port, deadline));
}

async function resolveReadinessHost(containerId: string, resourceNetworkName: string): Promise<string | null> {
  try {
    return await resolveResourceReadinessHost(containerId, resourceNetworkName);
  } catch {
    return null;
  }
}

async function ensureResourceContainerIsRunning(containerId: string): Promise<void> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef: containerId });
  if (container?.isRunning !== true) {
    throw new Error(`Expected resource container ${containerId} to remain running after startup.`);
  }
}
