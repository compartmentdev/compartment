import type { CommandResult } from './command-runner.types';
import { runQuietDockerCommand } from './docker-command';
import {
  buildComposeArguments,
  createMissingSelfHostedRuntimeServiceInspection,
  readComposePsServices,
  readDockerInspectContainerCandidate,
  readDockerInspectHealth,
  readDockerInspectImageRef,
  readDockerInspectPublishedPorts,
  readDockerInspectStartedAt,
  readDockerInspectStatus,
} from './docker-runtime.inspect.helpers';
import type { ComposePsServiceEntry, DockerInspectContainerCandidate } from './docker-runtime.inspect.types';
import { selfHostedComposeServiceNames, selfHostedSystemServiceNames } from './docker-runtime.service-names';
import { inspectNodeAgentHostService } from './node-agent-service';
import type {
  DockerExecutionContext,
  InspectSelfHostedRuntimeInput,
  SelfHostedRuntimeCommandInput,
  SelfHostedRuntimeServiceInspection,
  StartSelfHostedRuntimeInput,
} from './docker-runtime.types';
import type { SystemServiceName } from '@compartment/contracts';

export async function inspectSelfHostedRuntimeServices(
  context: DockerExecutionContext,
  input: InspectSelfHostedRuntimeInput,
): Promise<SelfHostedRuntimeServiceInspection[]> {
  const composeServices: Map<SystemServiceName, ComposePsServiceEntry> | null = await readComposeServiceMap(
    context,
    input,
  );
  const inspections: SelfHostedRuntimeServiceInspection[] = [];

  for (const serviceName of selfHostedSystemServiceNames) {
    inspections.push(
      await inspectSelfHostedRuntimeService(context, input, serviceName, composeServices?.get(serviceName)),
    );
  }

  return inspections;
}

export async function inspectSelfHostedComposeRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
): Promise<SelfHostedRuntimeServiceInspection[]> {
  const composeServices: Map<SystemServiceName, ComposePsServiceEntry> | null = await readComposeServiceMap(
    context,
    input,
  );
  const inspections: SelfHostedRuntimeServiceInspection[] = [];

  for (const serviceName of selfHostedComposeServiceNames) {
    inspections.push(await inspectComposeRuntimeService(context, serviceName, composeServices?.get(serviceName)));
  }

  return inspections;
}

async function inspectSelfHostedRuntimeService(
  context: DockerExecutionContext,
  input: InspectSelfHostedRuntimeInput,
  serviceName: SystemServiceName,
  composeService: ComposePsServiceEntry | undefined,
): Promise<SelfHostedRuntimeServiceInspection> {
  if (serviceName === 'node') {
    return await inspectNodeAgentHostService({ nodeSocketPath: input.nodeSocketPath });
  }
  return await inspectComposeRuntimeService(context, serviceName, composeService);
}

async function inspectComposeRuntimeService(
  context: DockerExecutionContext,
  serviceName: SystemServiceName,
  composeService: ComposePsServiceEntry | undefined,
): Promise<SelfHostedRuntimeServiceInspection> {
  if (composeService?.containerId == null) {
    return createMissingSelfHostedRuntimeServiceInspectionResult(serviceName);
  }

  return await readInspectedSelfHostedRuntimeService(context, serviceName, composeService);
}

async function readComposeServiceMap(
  context: DockerExecutionContext,
  input: SelfHostedRuntimeCommandInput,
): Promise<Map<SystemServiceName, ComposePsServiceEntry> | null> {
  const psResult: CommandResult = await runQuietDockerCommand(context, buildComposePsArguments(input));
  if (psResult.exitCode !== 0) {
    return null;
  }

  return new Map<SystemServiceName, ComposePsServiceEntry>(
    readComposePsServices(psResult.stdout).map(
      (service: ComposePsServiceEntry): [SystemServiceName, ComposePsServiceEntry] => [service.name, service],
    ),
  );
}

async function readInspectedSelfHostedRuntimeService(
  context: DockerExecutionContext,
  serviceName: SystemServiceName,
  composeService: ComposePsServiceEntry,
): Promise<SelfHostedRuntimeServiceInspection> {
  const inspectResult: CommandResult = await runQuietDockerCommand(context, ['inspect', composeService.containerId!]);
  const inspectedContainer: DockerInspectContainerCandidate | null =
    inspectResult.exitCode === 0 ? readDockerInspectContainerCandidate(inspectResult.stdout) : null;

  return inspectedContainer === null
    ? createComposeInspectionFallback(composeService)
    : createInspectedSelfHostedRuntimeService(serviceName, composeService, inspectedContainer);
}

function createComposeInspectionFallback(composeService: ComposePsServiceEntry): SelfHostedRuntimeServiceInspection {
  return {
    ...composeService,
    startedAt: null,
  };
}

function buildComposePsArguments(input: SelfHostedRuntimeCommandInput): string[] {
  return [
    ...buildComposeArguments(
      input.installDirectory,
      input.envPath,
      input.composePath,
      input.localComposePath,
      input.imageSource === 'local',
    ),
    'ps',
    '--all',
    '--format',
    'json',
  ];
}

function createInspectedSelfHostedRuntimeService(
  serviceName: SystemServiceName,
  composeService: ComposePsServiceEntry,
  inspectedContainer: DockerInspectContainerCandidate,
): SelfHostedRuntimeServiceInspection {
  return {
    containerId: composeService.containerId,
    health: readDockerInspectHealth(inspectedContainer) ?? composeService.health,
    imageRef: readDockerInspectImageRef(inspectedContainer) ?? composeService.imageRef,
    name: serviceName,
    publishedPorts: readDockerInspectPublishedPorts(inspectedContainer) ?? composeService.publishedPorts,
    startedAt: readDockerInspectStartedAt(inspectedContainer),
    status: readDockerInspectStatus(inspectedContainer) ?? composeService.status,
  };
}

function createMissingSelfHostedRuntimeServiceInspectionResult(
  serviceName: SystemServiceName,
): SelfHostedRuntimeServiceInspection {
  return {
    ...createMissingSelfHostedRuntimeServiceInspection(serviceName),
    startedAt: null,
  };
}
