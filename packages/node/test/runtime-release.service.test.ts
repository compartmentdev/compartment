import type {
  DockerContainerSecurityProfile,
  DockerInspectImageResult,
  DockerRunContainerInput,
  DockerRunContainerToCompletionResult,
} from '@compartment/docker';
import type { NodeReleaseRequest, NodeReleaseResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createRuntimeNetworkCapacityExhaustedError, isNodeRuntimeError } from '../src/errors/node-runtime-error';
import { releaseRuntimeContainer } from '../src/services/runtime-release.service';
import type { RuntimeDeployConfig } from '../src/services/runtime.types';
import { createRuntimeNetworkPoolConfig } from './runtime-network-pool.fixture';

type BuildDockerNamespaceLabels = (namespace: string) => Record<string, string>;
type EnsureDockerImageAvailable = (input: { imageRef: string }) => Promise<void>;
type EnsureDockerNetwork = (input: { labels: Record<string, string>; networkName: string }) => Promise<void>;
type InspectDockerImage = (input: { imageRef: string }) => Promise<DockerInspectImageResult>;
type IsDockerNetworkIpamCapacityError = (error: Error) => boolean;
type ReadDockerEngineErrorMessage = (error: Error) => string;
type RemoveDockerContainer = (input: { containerRef: string }) => Promise<void>;
type RunDockerContainerToCompletion = (input: DockerRunContainerInput) => Promise<DockerRunContainerToCompletionResult>;
type EnsureRuntimeResourceNetwork = (
  input: Pick<NodeReleaseRequest, 'environmentId' | 'projectId'>,
  config: RuntimeDeployConfig,
) => Promise<string>;
type AssertRuntimeResourceNetworkFreeEndpoints = (
  input: Pick<NodeReleaseRequest, 'environmentId' | 'projectId'>,
  config: RuntimeDeployConfig,
  requiredFreeEndpoints: number,
  reason: string,
) => Promise<void>;

interface RuntimeReleaseServiceTestMocks {
  assertRuntimeResourceNetworkFreeEndpoints: Mock<AssertRuntimeResourceNetworkFreeEndpoints>;
  buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
  ensureDockerImageAvailable: Mock<EnsureDockerImageAvailable>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  ensureRuntimeResourceNetwork: Mock<EnsureRuntimeResourceNetwork>;
  inspectDockerImage: Mock<InspectDockerImage>;
  isDockerNetworkIpamCapacityError: Mock<IsDockerNetworkIpamCapacityError>;
  readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
  removeDockerContainer: Mock<RemoveDockerContainer>;
  runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
}

const mocks: RuntimeReleaseServiceTestMocks = vi.hoisted(
  (): RuntimeReleaseServiceTestMocks => ({
    assertRuntimeResourceNetworkFreeEndpoints: vi.fn<AssertRuntimeResourceNetworkFreeEndpoints>(),
    buildDockerNamespaceLabels: vi.fn<BuildDockerNamespaceLabels>(
      (namespace: string): Record<string, string> => ({
        'compartment.namespace': namespace,
      }),
    ),
    ensureDockerImageAvailable: vi.fn<EnsureDockerImageAvailable>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    ensureRuntimeResourceNetwork: vi.fn<EnsureRuntimeResourceNetwork>(),
    inspectDockerImage: vi.fn<InspectDockerImage>(),
    isDockerNetworkIpamCapacityError: vi.fn<IsDockerNetworkIpamCapacityError>(),
    readDockerEngineErrorMessage: vi.fn<ReadDockerEngineErrorMessage>(),
    removeDockerContainer: vi.fn<RemoveDockerContainer>(),
    runDockerContainerToCompletion: vi.fn<RunDockerContainerToCompletion>(),
  }),
);

const releaseContainerSecurityProfile: DockerContainerSecurityProfile = {
  name: 'restricted-writable',
  writableRootFilesystemReason: 'User release commands can require writable runtime paths.',
};

vi.mock(
  '@compartment/docker',
  (): {
    buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
    ensureDockerImageAvailable: Mock<EnsureDockerImageAvailable>;
    ensureDockerNetwork: Mock<EnsureDockerNetwork>;
    inspectDockerImage: Mock<InspectDockerImage>;
    isDockerNetworkIpamCapacityError: Mock<IsDockerNetworkIpamCapacityError>;
    readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
    removeDockerContainer: Mock<RemoveDockerContainer>;
    runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
  } => ({
    buildDockerNamespaceLabels: mocks.buildDockerNamespaceLabels,
    ensureDockerImageAvailable: mocks.ensureDockerImageAvailable,
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    inspectDockerImage: mocks.inspectDockerImage,
    isDockerNetworkIpamCapacityError: mocks.isDockerNetworkIpamCapacityError,
    readDockerEngineErrorMessage: mocks.readDockerEngineErrorMessage,
    removeDockerContainer: mocks.removeDockerContainer,
    runDockerContainerToCompletion: mocks.runDockerContainerToCompletion,
  }),
);

vi.mock(
  '../src/services/runtime-network-capacity.service',
  (): {
    assertRuntimeResourceNetworkFreeEndpoints: Mock<AssertRuntimeResourceNetworkFreeEndpoints>;
    ensureRuntimeResourceNetwork: Mock<EnsureRuntimeResourceNetwork>;
  } => ({
    assertRuntimeResourceNetworkFreeEndpoints: mocks.assertRuntimeResourceNetworkFreeEndpoints,
    ensureRuntimeResourceNetwork: mocks.ensureRuntimeResourceNetwork,
  }),
);

afterEach((): void => {
  mocks.assertRuntimeResourceNetworkFreeEndpoints.mockReset();
  mocks.buildDockerNamespaceLabels.mockClear();
  mocks.ensureDockerImageAvailable.mockReset();
  mocks.ensureDockerNetwork.mockReset();
  mocks.ensureRuntimeResourceNetwork.mockReset();
  mocks.inspectDockerImage.mockReset();
  mocks.isDockerNetworkIpamCapacityError.mockReset();
  mocks.readDockerEngineErrorMessage.mockReset();
  mocks.removeDockerContainer.mockReset();
  mocks.runDockerContainerToCompletion.mockReset();
});

describe('releaseRuntimeContainer', (): void => {
  it('runs release command from the built image on the resource network', async (): Promise<void> => {
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockResolvedValueOnce(
      'compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824',
    );
    mocks.runDockerContainerToCompletion.mockResolvedValueOnce({
      containerId: 'release_container_123',
      logs: [
        {
          message: 'migrations complete',
          stream: 'stdout',
          timestamp: null,
        },
      ],
      stderr: '',
      stdout: 'migrations complete',
    });

    const response: NodeReleaseResponse = await releaseRuntimeContainer(
      createReleaseRequest(),
      createRuntimeDeployConfig(),
    );

    expect(response.stdout).toBe('migrations complete');
    expect(response.logs).toEqual([{ message: 'migrations complete', stream: 'stdout' }]);
    expect(mocks.removeDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456-release',
    });
    expect(mocks.ensureRuntimeResourceNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
      }),
      expect.objectContaining({ dockerNamespace: 'compartment-e2e' }),
    );
    expect(mocks.ensureRuntimeResourceNetwork.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runDockerContainerToCompletion.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.runDockerContainerToCompletion).toHaveBeenCalledWith({
      command: ['pnpm db:migrate'],
      containerName: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456-release',
      entrypoint: ['sh', '-lc'],
      env: {
        PORT: '3000',
      },
      imageRef: 'sha256:image',
      labels: {
        'compartment.namespace': 'compartment-e2e',
        'compartment.deploymentId': 'dep_123456',
        'compartment.environment': 'production',
        'compartment.environmentId': 'env_production',
        'compartment.project': 'smoke-web',
        'compartment.projectId': 'prj_smoke_web',
        'compartment.release': 'true',
        'compartment.service': 'web',
        'compartment.serviceId': 'svc_web',
      },
      network: {
        aliases: [],
        name: 'compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824',
      },
      securityProfile: releaseContainerSecurityProfile,
      timeoutMs: 600000,
    });
  });

  it('preserves image shell entrypoints for release commands', async (): Promise<void> => {
    mocks.inspectDockerImage.mockResolvedValueOnce({
      entrypoint: ['/bin/bash', '-l', '-c'],
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockResolvedValueOnce(
      'compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824',
    );
    mocks.runDockerContainerToCompletion.mockResolvedValueOnce({
      containerId: 'release_container_123',
      logs: [],
      stderr: '',
      stdout: '',
    });

    await releaseRuntimeContainer(createReleaseRequest(), createRuntimeDeployConfig());

    expect(mocks.runDockerContainerToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ['pnpm db:migrate'],
        entrypoint: ['/bin/bash', '-l', '-c'],
      }),
    );
  });

  it('uses the default shell entrypoint when the image shell entrypoint does not accept a command', async (): Promise<void> => {
    mocks.inspectDockerImage.mockResolvedValueOnce({
      entrypoint: ['/bin/bash', '--rcfile'],
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockResolvedValueOnce(
      'compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824',
    );
    mocks.runDockerContainerToCompletion.mockResolvedValueOnce({
      containerId: 'release_container_123',
      logs: [],
      stderr: '',
      stdout: '',
    });

    await releaseRuntimeContainer(createReleaseRequest(), createRuntimeDeployConfig());

    expect(mocks.runDockerContainerToCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ['pnpm db:migrate'],
        entrypoint: ['sh', '-lc'],
      }),
    );
  });

  it('does not start the release operation on an unowned resource network', async (): Promise<void> => {
    const ownershipError: Error = new Error(
      'Docker runtime network compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824 exists without required managed Compartment network labels.',
    );
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockRejectedValueOnce(ownershipError);

    await expect(releaseRuntimeContainer(createReleaseRequest(), createRuntimeDeployConfig())).rejects.toThrow(
      ownershipError.message,
    );

    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it('preserves runtime network errors instead of wrapping them as release command failures', async (): Promise<void> => {
    const capacityError: Error = createRuntimeNetworkCapacityExhaustedError('No subnet remains.');
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockRejectedValueOnce(capacityError);

    let failure: Error | undefined;
    try {
      await releaseRuntimeContainer(createReleaseRequest(), createRuntimeDeployConfig());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toBe(capacityError);
    expect(isNodeRuntimeError(failure)).toBe(true);
    expect(failure?.message).not.toContain('release command failed');
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it('reconciles release networks when pre-run container cleanup fails', async (): Promise<void> => {
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockResolvedValueOnce(
      'compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824',
    );
    mocks.removeDockerContainer.mockRejectedValueOnce(new Error('remove failed')).mockResolvedValueOnce(undefined);

    await expect(releaseRuntimeContainer(createReleaseRequest(), createRuntimeDeployConfig())).rejects.toThrow(
      'remove failed',
    );

    expect(mocks.ensureRuntimeResourceNetwork).toHaveBeenCalled();
    expect(mocks.removeDockerContainer).toHaveBeenCalledTimes(2);
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it('fails with release logs when the release command exits nonzero', async (): Promise<void> => {
    const error: Error & { stderr?: string; stdout?: string } = new Error(
      'Docker operation container release failed with exit code 1.',
    );
    error.stdout = 'migrating';
    error.stderr = 'relation contacts does not exist';
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockResolvedValueOnce(
      'compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824',
    );
    mocks.runDockerContainerToCompletion.mockRejectedValueOnce(error);

    await expect(releaseRuntimeContainer(createReleaseRequest(), createRuntimeDeployConfig())).rejects.toThrow(
      'Last logs:\n[stdout] migrating\n[stderr] relation contacts does not exist',
    );
  });

  it('preserves ordered release logs when a timed-out command fails', async (): Promise<void> => {
    const error: Error & {
      logs?: { message: string; stream: 'stderr' | 'stdout'; timestamp: string | null }[];
      stderr?: string;
      stdout?: string;
    } = new Error('Docker operation container release timed out after 600000ms.');
    error.logs = [
      { message: 'migrating', stream: 'stdout', timestamp: null },
      { message: 'waiting on lock', stream: 'stderr', timestamp: null },
    ];
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeResourceNetwork.mockResolvedValueOnce(
      'compartment-compartment-e2e-prj-smoke-web-env-prod-f9f428dca824',
    );
    mocks.runDockerContainerToCompletion.mockRejectedValueOnce(error);

    await expect(releaseRuntimeContainer(createReleaseRequest(), createRuntimeDeployConfig())).rejects.toThrow(
      'Last logs:\n[stdout] migrating\n[stderr] waiting on lock',
    );
  });
});

function createReleaseRequest(overrides: Partial<NodeReleaseRequest> = {}): NodeReleaseRequest {
  return {
    deploymentId: 'dep_123456',
    environmentId: 'env_production',
    environmentName: 'production',
    imageRef: 'sha256:image',
    projectId: 'prj_smoke_web',
    projectName: 'smoke-web',
    release: {
      command: 'pnpm db:migrate',
    },
    runtimeNetwork: {
      requiresResourceNetwork: true,
    },
    runtimeEnv: {},
    serviceId: 'svc_web',
    serviceName: 'web',
    ...overrides,
  };
}

function createRuntimeDeployConfig(overrides: Partial<RuntimeDeployConfig> = {}): RuntimeDeployConfig {
  return {
    appPortEnd: 31010,
    appPortStart: 31000,
    dockerNamespace: 'compartment-e2e',
    runtimeConnectivityMode: 'loopback',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    ...overrides,
  };
}
