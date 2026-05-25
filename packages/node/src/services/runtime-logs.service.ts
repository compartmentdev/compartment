import {
  inspectDockerContainer,
  tailDockerContainerLogs,
  type DockerInspectContainerResult,
  type DockerLogLine,
  type DockerTailLogsResult,
} from '@compartment/docker';
import type { DeploymentLogLine, NodeTailLogsQuery, NodeTailLogsResponse } from '@compartment/contracts';
import { compareLogTimestamps } from './runtime-log-timestamps.service';
import type { RuntimeDockerTailLogsInput } from './runtime-logs.service.types';

export async function tailRuntimeContainerLogs(input: NodeTailLogsQuery): Promise<NodeTailLogsResponse> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({
    containerRef: input.containerId,
  });
  if (container === null) {
    return {
      lines: [],
    };
  }

  const output: DockerTailLogsResult = await tailDockerContainerLogs(buildDockerTailLogsInput(input));
  const lines: DeploymentLogLine[] = output.lines
    .map((line: DockerLogLine): DeploymentLogLine => buildLogLine(line, input))
    .filter((line: DeploymentLogLine): boolean => isLogLineAtOrAfterSince(line, input.since));

  return {
    lines,
  };
}

function buildDockerTailLogsInput(input: NodeTailLogsQuery): RuntimeDockerTailLogsInput {
  const tailLines: number | undefined = readDefaultTailLines(input);

  return {
    containerId: input.containerId,
    ...(input.since !== undefined ? { since: input.since } : {}),
    ...(tailLines !== undefined ? { tailLines } : {}),
  };
}

function readDefaultTailLines(input: NodeTailLogsQuery): number | undefined {
  return input.tailLines ?? (input.since === undefined ? 100 : undefined);
}

function buildLogLine(line: DockerLogLine, input: NodeTailLogsQuery): DeploymentLogLine {
  return {
    deploymentId: input.deploymentId,
    environmentName: input.environmentName,
    message: line.message,
    serviceName: input.serviceName,
    stream: line.stream,
    timestamp: line.timestamp ?? new Date().toISOString(),
  };
}

function isLogLineAtOrAfterSince(line: DeploymentLogLine, since: string | undefined): boolean {
  if (since === undefined) {
    return true;
  }

  return compareLogTimestamps(line.timestamp, since) >= 0;
}
