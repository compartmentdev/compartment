import type { DockerInspectContainerResult, DockerTailLogsResult } from '@compartment/docker';
import type { NodeResourceLogsResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { tailRuntimeResourceLogs } from '../src/services/runtime-resource-logs.service';

type TailDockerContainerLogs = (input: {
  containerId: string;
  since?: string | undefined;
  tailLines?: number | undefined;
}) => Promise<DockerTailLogsResult>;
type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResult | null>;

interface RuntimeResourceLogsServiceMocks {
  inspectDockerContainer: Mock<InspectDockerContainer>;
  tailDockerContainerLogs: Mock<TailDockerContainerLogs>;
}

const mocks: RuntimeResourceLogsServiceMocks = vi.hoisted(
  (): RuntimeResourceLogsServiceMocks => ({
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    tailDockerContainerLogs: vi.fn<TailDockerContainerLogs>(),
  }),
);

vi.mock(
  '@compartment/docker',
  (): {
    inspectDockerContainer: Mock<InspectDockerContainer>;
    tailDockerContainerLogs: Mock<TailDockerContainerLogs>;
  } => ({
    inspectDockerContainer: mocks.inspectDockerContainer,
    tailDockerContainerLogs: mocks.tailDockerContainerLogs,
  }),
);

afterEach((): void => {
  mocks.inspectDockerContainer.mockReset();
  mocks.tailDockerContainerLogs.mockReset();
});

describe('tailRuntimeResourceLogs', (): void => {
  it('returns an empty log response when the resource container is missing', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce(null);

    const response: NodeResourceLogsResponse = await tailRuntimeResourceLogs({
      containerId: 'resource_container_missing',
      environmentName: 'production',
      resourceName: 'postgres',
    });

    expect(response.lines).toEqual([]);
    expect(mocks.inspectDockerContainer).toHaveBeenCalledWith({
      containerRef: 'resource_container_missing',
    });
    expect(mocks.tailDockerContainerLogs).not.toHaveBeenCalled();
  });

  it('filters docker log lines using full timestamp precision within the same millisecond', async (): Promise<void> => {
    mocks.tailDockerContainerLogs.mockResolvedValueOnce({
      lines: [
        {
          message: 'older within the same millisecond',
          stream: 'stdout',
          timestamp: '2026-03-23T12:00:00.123456788Z',
        },
        {
          message: 'newer within the same millisecond',
          stream: 'stderr',
          timestamp: '2026-03-23T12:00:00.123456790Z',
        },
      ],
    });

    const response: NodeResourceLogsResponse = await tailRuntimeResourceLogs({
      containerId: 'resource_container_123',
      environmentName: 'production',
      resourceName: 'postgres',
      since: '2026-03-23T12:00:00.123456789Z',
    });

    expect(response.lines).toEqual([
      {
        message: 'newer within the same millisecond',
        resourceName: 'postgres',
        stream: 'stderr',
        timestamp: '2026-03-23T12:00:00.123456790Z',
      },
    ]);
  });
});
