import {
  inspectDockerContainer,
  listDockerContainers,
  type DockerInspectContainerResult,
  type DockerListContainerResult,
  type DockerPublishedPort,
} from '@compartment/docker';

export async function findAvailablePort(
  start: number,
  end: number,
  excludedPorts: number[],
  host: string,
): Promise<number> {
  const unavailablePorts: Set<number> = await readUnavailableHostPorts(host, excludedPorts);

  for (let port: number = start; port <= end; port += 1) {
    if (!unavailablePorts.has(port)) {
      return port;
    }
  }

  throw new Error(`No free application ports are available in range ${start}-${end}.`);
}

async function readUnavailableHostPorts(host: string, excludedPorts: number[]): Promise<Set<number>> {
  const runningContainers: DockerListContainerResult[] = await listDockerContainers();
  const inspectedContainers: (DockerInspectContainerResult | null)[] = await Promise.all(
    runningContainers.map(
      async (container: DockerListContainerResult): Promise<DockerInspectContainerResult | null> =>
        await inspectDockerContainer({ containerRef: container.containerId }),
    ),
  );

  const unavailablePorts: Set<number> = new Set<number>(excludedPorts);
  for (const container of inspectedContainers) {
    if (container === null) {
      continue;
    }
    addPublishedHostPorts(unavailablePorts, container.publishedPorts, host);
  }

  return unavailablePorts;
}

function addPublishedHostPorts(
  unavailablePorts: Set<number>,
  publishedPorts: DockerPublishedPort[],
  host: string,
): void {
  for (const publishedPort of publishedPorts) {
    if (matchesPublishedHost(publishedPort.hostIp, host)) {
      unavailablePorts.add(publishedPort.hostPort);
    }
  }
}

function matchesPublishedHost(hostIp: string | undefined, host: string): boolean {
  return hostIp === undefined || hostIp === '' || hostIp === '0.0.0.0' || hostIp === host;
}
