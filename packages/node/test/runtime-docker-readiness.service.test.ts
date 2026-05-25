import type { DockerRunContainerInput, DockerRunContainerToCompletionResult } from '@compartment/docker';
import type { ResolvedServiceReadinessConfig } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { waitForHealthyRuntimeFromDockerNetwork } from '../src/services/runtime-docker-readiness.service';

type BuildDockerNamespaceLabels = (namespace: string) => Record<string, string>;
type RequireDockerImageAvailable = (input: { imageRef: string }) => Promise<void>;
type RunDockerContainerToCompletion = (input: DockerRunContainerInput) => Promise<DockerRunContainerToCompletionResult>;

interface RuntimeDockerReadinessTestMocks {
  buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
  requireDockerImageAvailable: Mock<RequireDockerImageAvailable>;
  runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
}

const mocks: RuntimeDockerReadinessTestMocks = vi.hoisted(
  (): RuntimeDockerReadinessTestMocks => ({
    buildDockerNamespaceLabels: vi.fn<BuildDockerNamespaceLabels>(
      (namespace: string): Record<string, string> => ({
        'compartment.namespace': namespace,
      }),
    ),
    requireDockerImageAvailable: vi.fn<RequireDockerImageAvailable>(),
    runDockerContainerToCompletion: vi.fn<RunDockerContainerToCompletion>(),
  }),
);

vi.mock(
  '@compartment/docker',
  (): {
    buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
    requireDockerImageAvailable: Mock<RequireDockerImageAvailable>;
    runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
  } => ({
    buildDockerNamespaceLabels: mocks.buildDockerNamespaceLabels,
    requireDockerImageAvailable: mocks.requireDockerImageAvailable,
    runDockerContainerToCompletion: mocks.runDockerContainerToCompletion,
  }),
);

afterEach((): void => {
  mocks.buildDockerNamespaceLabels.mockClear();
  mocks.requireDockerImageAvailable.mockReset();
  mocks.runDockerContainerToCompletion.mockReset();
});

describe('waitForHealthyRuntimeFromDockerNetwork', (): void => {
  it('probes through the configured packaged runtime image', async (): Promise<void> => {
    mocks.runDockerContainerToCompletion.mockResolvedValueOnce({
      containerId: 'probe_container',
      logs: [],
      stderr: '',
      stdout: '',
    });

    await waitForHealthyRuntimeFromDockerNetwork({
      dockerNamespace: 'compartment-test',
      host: 'compartment-service',
      hostHeader: 'compartment-service',
      networkName: 'compartment-test-runtime',
      port: 3000,
      probeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:1.2.3',
      readiness: createReadiness(),
    });

    expect(mocks.requireDockerImageAvailable).toHaveBeenCalledWith({
      imageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:1.2.3',
    });
    const probeInput: DockerRunContainerInput = readProbeInput();
    expect(probeInput.command?.[0]).toBe('node');
    expect(probeInput.command?.[1]).toBe('-e');
    expect(probeInput.command?.[2]).toContain("require('node:http')");
    expect(probeInput.containerName).toMatch(/^compartment-compartment-test-readiness-/);
    expect(probeInput).toEqual({
      command: probeInput.command,
      containerName: probeInput.containerName,
      env: {
        COMPARTMENT_READINESS_HOST_HEADER: 'compartment-service:3000',
        COMPARTMENT_READINESS_TIMEOUT_MS: '5000',
        COMPARTMENT_READINESS_URL: 'http://compartment-service:3000/healthz',
      },
      imageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:1.2.3',
      labels: {
        'compartment.namespace': 'compartment-test',
        'compartment.operation': 'runtime-readiness-probe',
      },
      network: {
        name: 'compartment-test-runtime',
      },
      securityProfile: {
        name: 'restricted-readonly',
        tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=16m'],
        user: 'node',
      },
    });
  });
});

function readProbeInput(): DockerRunContainerInput {
  const probeInput: DockerRunContainerInput | undefined = mocks.runDockerContainerToCompletion.mock.calls[0]?.[0];
  if (probeInput === undefined) {
    throw new Error('Expected runtime readiness probe container input.');
  }

  return probeInput;
}

function createReadiness(): ResolvedServiceReadinessConfig {
  return {
    path: '/healthz',
    timeoutMs: 30_000,
    type: 'http',
  };
}
