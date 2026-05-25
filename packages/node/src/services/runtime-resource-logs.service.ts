import {
  inspectDockerContainer,
  tailDockerContainerLogs,
  type DockerInspectContainerResult,
  type DockerLogLine,
  type DockerTailLogsResult,
} from '@compartment/docker';
import type { NodeResourceLogsQuery, NodeResourceLogsResponse, ResourceLogLine } from '@compartment/contracts';
import { compareLogTimestamps } from './runtime-log-timestamps.service';

export async function tailRuntimeResourceLogs(input: NodeResourceLogsQuery): Promise<NodeResourceLogsResponse> {
  if (!(await hasResourceRuntimeContainer(input.containerId))) {
    return {
      lines: [],
    };
  }

  const logs: DockerTailLogsResult = await tailDockerContainerLogs({
    containerId: input.containerId,
    ...(input.since !== undefined ? { since: input.since } : {}),
    ...(input.tailLines !== undefined ? { tailLines: input.tailLines } : {}),
  });

  return {
    lines: logs.lines
      .map(
        (line: DockerLogLine): ResourceLogLine => ({
          message: line.message,
          resourceName: input.resourceName,
          stream: line.stream,
          timestamp: line.timestamp ?? new Date(0).toISOString(),
        }),
      )
      .filter((line: ResourceLogLine): boolean => isLogLineAtOrAfterSince(line, input.since)),
  };
}

async function hasResourceRuntimeContainer(containerId: string): Promise<boolean> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({
    containerRef: containerId,
  });

  return container !== null;
}

function isLogLineAtOrAfterSince(line: ResourceLogLine, since: string | undefined): boolean {
  if (since === undefined) {
    return true;
  }

  return compareLogTimestamps(line.timestamp, since) >= 0;
}
