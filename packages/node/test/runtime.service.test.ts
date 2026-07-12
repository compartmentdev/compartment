import type {
  DockerContainerSecurityProfile,
  DockerInspectContainerResult,
  DockerInspectImageResult,
  DockerInspectNetworkResult,
  DockerRunContainerInput,
  DockerRunContainerResult,
  DockerRunContainerToCompletionResult,
  DockerTailLogsResult,
} from '@compartment/docker';
import {
  nodeRuntimeServiceReadinessFailedErrorCode,
  nodeRuntimeServiceStartupFailedErrorCode,
  type NodeDeployRequest,
  type NodeDeployResponse,
  type NodeDrainDeploymentResponse,
  type NodeStopDeploymentResponse,
  type NodeTailLogsResponse,
  type ResolvedServiceReadinessConfig,
} from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NodeConfig } from '../src/config';
import { createRuntimeNetworkCapacityExhaustedError, isNodeRuntimeError } from '../src/errors/node-runtime-error';
import { buildRuntimeResourceNetworkName, buildRuntimeServiceNetworkName } from '../src/services/runtime-names.service';
import {
  drainRuntimeContainer,
  deployRuntimeContainer,
  stopRuntimeContainer,
  tailRuntimeContainerLogs,
} from '../src/services/runtime.service';
import type { RuntimeDeployConfig } from '../src/services/runtime.types';
import {
  createDeployRequest,
  createNodeConfig,
  createReadiness,
  createRun,
  createRuntimeDeployConfig,
} from './runtime.service.fixtures';

type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResult | null>;
type InspectDockerImage = (input: { imageRef: string }) => Promise<DockerInspectImageResult>;
type InspectDockerNetwork = (input: { networkName: string }) => Promise<DockerInspectNetworkResult | null>;
type RemoveDockerContainer = (input: { containerRef: string }) => Promise<void>;
type RequireDockerImageAvailable = (input: { imageRef: string }) => Promise<void>;
type RunDockerContainer = (input: DockerRunContainerInput) => Promise<DockerRunContainerResult>;
type RunDockerContainerToCompletion = (input: DockerRunContainerInput) => Promise<DockerRunContainerToCompletionResult>;
type ConnectDockerContainerToNetwork = (input: { containerRef: string; networkName: string }) => Promise<void>;
type EnsureDockerNetwork = (input: { labels: Record<string, string>; networkName: string }) => Promise<void>;
type IsDockerNetworkIpamCapacityError = (error: Error) => boolean;
type ReadDockerEngineErrorMessage = (error: Error) => string;
type TailDockerContainerLogs = (input: {
  containerId: string;
  since?: string | undefined;
  tailLines?: number | undefined;
}) => Promise<DockerTailLogsResult>;
type BuildDockerNamespaceLabels = (namespace: string) => Record<string, string>;
type EnsureRuntimeNetworkForDeployment = (
  config: RuntimeDeployConfig,
  input: Pick<NodeDeployRequest, 'environmentId' | 'projectId' | 'serviceId'>,
) => Promise<string>;
type EnsureRuntimeResourceNetwork = (
  input: Pick<NodeDeployRequest, 'environmentId' | 'projectId'>,
  config: RuntimeDeployConfig,
) => Promise<string>;
type AssertRuntimeResourceNetworkFreeEndpoints = (
  input: Pick<NodeDeployRequest, 'environmentId' | 'projectId'>,
  config: RuntimeDeployConfig,
  requiredFreeEndpoints: number,
  reason: string,
) => Promise<void>;
type FindAvailablePort = (start: number, end: number, excludedPorts: number[], host: string) => Promise<number>;
type ReconcileRuntimeNetworks = (
  config: { dockerNamespace: string; runtimeConnectivityMode: string },
  options?: { disconnectCaddyStaleNetworks?: boolean | undefined },
) => Promise<void>;
type ResolveRuntimeNetworkActors = (config: RuntimeDeployConfig) => Promise<{ caddyContainerId: string }>;
type SyncRuntimeNetworkEgressDenyRules = (input: {
  dockerNamespace: string;
  networkNames: Iterable<string>;
  platformSourceContainerRefs?: readonly string[] | undefined;
}) => Promise<void>;
type WaitForHealthyRuntime = (
  host: string | (() => Promise<string>),
  hostPort: number,
  readiness: ResolvedServiceReadinessConfig,
  options?: { hostHeader?: string },
) => Promise<void>;

interface RuntimeServiceTestMocks {
  assertRuntimeResourceNetworkFreeEndpoints: Mock<AssertRuntimeResourceNetworkFreeEndpoints>;
  buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
  connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  ensureRuntimeNetworkForDeployment: Mock<EnsureRuntimeNetworkForDeployment>;
  ensureRuntimeResourceNetwork: Mock<EnsureRuntimeResourceNetwork>;
  findAvailablePort: Mock<FindAvailablePort>;
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerImage: Mock<InspectDockerImage>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  isDockerNetworkIpamCapacityError: Mock<IsDockerNetworkIpamCapacityError>;
  readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
  reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks>;
  removeDockerContainer: Mock<RemoveDockerContainer>;
  requireDockerImageAvailable: Mock<RequireDockerImageAvailable>;
  resolveRuntimeNetworkActors: Mock<ResolveRuntimeNetworkActors>;
  runDockerContainer: Mock<RunDockerContainer>;
  runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
  syncRuntimeNetworkEgressDenyRules: Mock<SyncRuntimeNetworkEgressDenyRules>;
  tailDockerContainerLogs: Mock<TailDockerContainerLogs>;
  waitForHealthyRuntime: Mock<WaitForHealthyRuntime>;
}

const mocks: RuntimeServiceTestMocks = vi.hoisted(
  (): RuntimeServiceTestMocks => ({
    assertRuntimeResourceNetworkFreeEndpoints: vi.fn<AssertRuntimeResourceNetworkFreeEndpoints>(),
    buildDockerNamespaceLabels: vi.fn<BuildDockerNamespaceLabels>(
      (namespace: string): Record<string, string> => ({
        'compartment.namespace': namespace,
      }),
    ),
    connectDockerContainerToNetwork: vi.fn<ConnectDockerContainerToNetwork>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    ensureRuntimeNetworkForDeployment: vi.fn<EnsureRuntimeNetworkForDeployment>(),
    ensureRuntimeResourceNetwork: vi.fn<EnsureRuntimeResourceNetwork>(),
    findAvailablePort: vi.fn<FindAvailablePort>(),
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerImage: vi.fn<InspectDockerImage>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    isDockerNetworkIpamCapacityError: vi.fn<IsDockerNetworkIpamCapacityError>(),
    readDockerEngineErrorMessage: vi.fn<ReadDockerEngineErrorMessage>(),
    reconcileRuntimeNetworks: vi.fn<ReconcileRuntimeNetworks>(),
    removeDockerContainer: vi.fn<RemoveDockerContainer>(),
    requireDockerImageAvailable: vi.fn<RequireDockerImageAvailable>(),
    resolveRuntimeNetworkActors: vi.fn<ResolveRuntimeNetworkActors>(),
    runDockerContainer: vi.fn<RunDockerContainer>(),
    runDockerContainerToCompletion: vi.fn<RunDockerContainerToCompletion>(),
    syncRuntimeNetworkEgressDenyRules: vi.fn<SyncRuntimeNetworkEgressDenyRules>(),
    tailDockerContainerLogs: vi.fn<TailDockerContainerLogs>(),
    waitForHealthyRuntime: vi.fn<WaitForHealthyRuntime>(),
  }),
);

const runtimeContainerSecurityProfile: DockerContainerSecurityProfile = {
  capabilityAdditions: {
    add: ['CHOWN', 'NET_BIND_SERVICE', 'SETGID', 'SETUID'],
    reason: 'User app images can use root entrypoints to prepare writable paths, bind low ports, then drop privileges.',
  },
  name: 'restricted-writable',
  writableRootFilesystemReason: 'User runtime images can require writable paths outside declared volumes.',
};

vi.mock(
  '@compartment/docker',
  (): {
    buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
    compartmentDockerNamespaceLabelName: string;
    connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
    ensureDockerImageAvailable: Mock<() => Promise<void>>;
    ensureDockerNetwork: Mock<EnsureDockerNetwork>;
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerImage: Mock<InspectDockerImage>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
    isDockerNetworkIpamCapacityError: Mock<IsDockerNetworkIpamCapacityError>;
    readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
    removeDockerContainer: Mock<RemoveDockerContainer>;
    requireDockerImageAvailable: Mock<RequireDockerImageAvailable>;
    runDockerContainer: Mock<RunDockerContainer>;
    runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
    tailDockerContainerLogs: Mock<TailDockerContainerLogs>;
  } => ({
    buildDockerNamespaceLabels: mocks.buildDockerNamespaceLabels,
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    connectDockerContainerToNetwork: mocks.connectDockerContainerToNetwork,
    ensureDockerImageAvailable: vi.fn<() => Promise<void>>(),
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerImage: mocks.inspectDockerImage,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
    isDockerNetworkIpamCapacityError: mocks.isDockerNetworkIpamCapacityError,
    readDockerEngineErrorMessage: mocks.readDockerEngineErrorMessage,
    removeDockerContainer: mocks.removeDockerContainer,
    requireDockerImageAvailable: mocks.requireDockerImageAvailable,
    runDockerContainer: mocks.runDockerContainer,
    runDockerContainerToCompletion: mocks.runDockerContainerToCompletion,
    tailDockerContainerLogs: mocks.tailDockerContainerLogs,
  }),
);
vi.mock('../src/services/runtime-health.service', (): { waitForHealthyRuntime: Mock<WaitForHealthyRuntime> } => ({
  waitForHealthyRuntime: mocks.waitForHealthyRuntime,
}));
vi.mock('../src/services/runtime-port.service', (): { findAvailablePort: Mock<FindAvailablePort> } => ({
  findAvailablePort: mocks.findAvailablePort,
}));
vi.mock(
  '../src/services/runtime-network.service',
  (): {
    ensureRuntimeNetworkForDeployment: Mock<EnsureRuntimeNetworkForDeployment>;
    reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks>;
  } => ({
    ensureRuntimeNetworkForDeployment: mocks.ensureRuntimeNetworkForDeployment,
    reconcileRuntimeNetworks: mocks.reconcileRuntimeNetworks,
  }),
);
vi.mock(
  '../src/services/runtime-network-actors.service',
  (): { resolveRuntimeNetworkActors: Mock<ResolveRuntimeNetworkActors> } => ({
    resolveRuntimeNetworkActors: mocks.resolveRuntimeNetworkActors,
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
vi.mock(
  '../src/services/runtime-network-egress.service',
  (): { syncRuntimeNetworkEgressDenyRules: Mock<SyncRuntimeNetworkEgressDenyRules> } => ({
    syncRuntimeNetworkEgressDenyRules: mocks.syncRuntimeNetworkEgressDenyRules,
  }),
);
afterEach((): void => {
  mocks.assertRuntimeResourceNetworkFreeEndpoints.mockReset();
  mocks.buildDockerNamespaceLabels.mockClear();
  mocks.connectDockerContainerToNetwork.mockReset();
  mocks.ensureDockerNetwork.mockReset();
  mocks.ensureRuntimeNetworkForDeployment.mockReset();
  mocks.ensureRuntimeResourceNetwork.mockReset();
  mocks.findAvailablePort.mockReset();
  mocks.inspectDockerContainer.mockReset();
  mocks.inspectDockerImage.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.isDockerNetworkIpamCapacityError.mockReset();
  mocks.readDockerEngineErrorMessage.mockReset();
  mocks.reconcileRuntimeNetworks.mockReset();
  mocks.removeDockerContainer.mockReset();
  mocks.requireDockerImageAvailable.mockReset();
  mocks.resolveRuntimeNetworkActors.mockReset();
  mocks.runDockerContainer.mockReset();
  mocks.runDockerContainerToCompletion.mockReset();
  mocks.syncRuntimeNetworkEgressDenyRules.mockReset();
  mocks.tailDockerContainerLogs.mockReset();
  mocks.waitForHealthyRuntime.mockReset();
});

describe('deployRuntimeContainer', (): void => {
  it('starts a direct container when no previous deployment is active', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    const response: NodeDeployResponse = await deployRuntimeContainer(
      createDeployRequest(),
      createRuntimeDeployConfig(),
    );

    expect(response.routeHost).toBe('smoke-web.localhost');
    expect(response.imageRef).toBe('sha256:image');
    expect(response.upstreamHost).toBe('127.0.0.1');
    expect(response.upstreamPort).toBe(31000);
    expect(mocks.runDockerContainer).toHaveBeenCalledWith({
      containerName: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
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
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.service': 'web',
        'compartment.serviceId': 'svc_web',
        'compartment.upstreamHost': '127.0.0.1',
        'compartment.upstreamPort': '31000',
      },
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
      restartPolicy: {
        name: 'on-failure',
      },
      securityProfile: runtimeContainerSecurityProfile,
    });
    expect(mocks.findAvailablePort).toHaveBeenCalledWith(31000, 31010, [], '127.0.0.1');
    expect(mocks.waitForHealthyRuntime).toHaveBeenCalledWith('127.0.0.1', 31000, createReadiness());
  });

  it('accepts deployments without readiness when the runtime stays running after start', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.inspectDockerContainer.mockResolvedValue({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {},
      publishedPorts: [],
    });

    const response: NodeDeployResponse = await deployRuntimeContainer(
      createDeployRequest({ readiness: null }),
      createRuntimeDeployConfig(),
    );

    expect(response.upstreamPort).toBe(31000);
    expect(mocks.inspectDockerContainer).toHaveBeenCalledTimes(2);
  });

  it('fails deployments without readiness when the runtime exits right after start', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.inspectDockerContainer
      .mockResolvedValueOnce({
        containerId: 'container_123',
        imageRef: 'sha256:image',
        isRunning: true,
        labels: {},
        publishedPorts: [],
      })
      .mockResolvedValueOnce({
        containerId: 'container_123',
        imageRef: 'sha256:image',
        isRunning: false,
        labels: {},
        publishedPorts: [],
      });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);

    let failure: Error | undefined;
    try {
      await deployRuntimeContainer(createDeployRequest({ readiness: null }), createRuntimeDeployConfig());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toContain('remain running after startup');
    expect(isNodeRuntimeError(failure)).toBe(true);
    if (isNodeRuntimeError(failure)) {
      expect(failure.code).toBe(nodeRuntimeServiceStartupFailedErrorCode);
    }
    expect(mocks.inspectDockerContainer).toHaveBeenCalledTimes(2);
  });

  it('surfaces Docker container start failures as service startup errors', async (): Promise<void> => {
    const dockerError: Error = Object.assign(new Error('Docker start failed.'), {
      json: {
        message: 'unable to find user definitelymissing',
      },
      statusCode: 400,
    });
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockRejectedValueOnce(dockerError);
    mocks.readDockerEngineErrorMessage.mockReturnValueOnce(
      'Docker start failed. unable to find user definitelymissing',
    );

    let failure: Error | undefined;
    try {
      await deployRuntimeContainer(createDeployRequest(), createRuntimeDeployConfig());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toBe('runtime startup failed: Docker start failed. unable to find user definitelymissing');
    expect(isNodeRuntimeError(failure)).toBe(true);
    if (isNodeRuntimeError(failure)) {
      expect(failure.code).toBe(nodeRuntimeServiceStartupFailedErrorCode);
    }
  });

  it('uses the compartment default container port when the image exposes no ports', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    const response: NodeDeployResponse = await deployRuntimeContainer(
      createDeployRequest(),
      createRuntimeDeployConfig(),
    );

    expect(response.routeHost).toBe('smoke-web.localhost');
    expect(mocks.runDockerContainer).toHaveBeenCalledWith({
      containerName: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
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
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.service': 'web',
        'compartment.serviceId': 'svc_web',
        'compartment.upstreamHost': '127.0.0.1',
        'compartment.upstreamPort': '31000',
      },
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
      restartPolicy: {
        name: 'on-failure',
      },
      securityProfile: runtimeContainerSecurityProfile,
    });
  });

  it('prefers an explicit runtime PORT over image metadata', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [8080],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    await deployRuntimeContainer(createDeployRequest({ runtimeEnv: { PORT: '4321' } }), createRuntimeDeployConfig());

    expect(mocks.runDockerContainer).toHaveBeenCalledWith({
      containerName: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
      env: {
        PORT: '4321',
      },
      imageRef: 'sha256:image',
      labels: {
        'compartment.namespace': 'compartment-e2e',
        'compartment.deploymentId': 'dep_123456',
        'compartment.environment': 'production',
        'compartment.environmentId': 'env_production',
        'compartment.project': 'smoke-web',
        'compartment.projectId': 'prj_smoke_web',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.service': 'web',
        'compartment.serviceId': 'svc_web',
        'compartment.upstreamHost': '127.0.0.1',
        'compartment.upstreamPort': '31000',
      },
      publishedPorts: [
        {
          containerPort: 4321,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
      restartPolicy: {
        name: 'on-failure',
      },
      securityProfile: runtimeContainerSecurityProfile,
    });
    expect(mocks.findAvailablePort).toHaveBeenCalledWith(31000, 31010, [], '127.0.0.1');
  });

  it('disables restart policy when the service opts out explicitly', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    await deployRuntimeContainer(
      createDeployRequest({
        routeHost: 'smoke-web.apps.localhost',
        run: createRun({
          restart: {
            policy: 'no',
          },
        }),
      }),
      createRuntimeDeployConfig(),
    );

    expect(mocks.runDockerContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        restartPolicy: {
          name: 'no',
        },
      }),
    );
  });

  it('maps on-failure maxRetries to the docker restart policy', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    await deployRuntimeContainer(
      createDeployRequest({
        routeHost: 'smoke-web.apps.localhost',
        run: createRun({
          restart: {
            maxRetries: 5,
            policy: 'on-failure',
          },
        }),
      }),
      createRuntimeDeployConfig(),
    );

    expect(mocks.runDockerContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        restartPolicy: {
          maximumRetryCount: 5,
          name: 'on-failure',
        },
      }),
    );
  });

  it('maps unless-stopped directly to the docker restart policy', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    await deployRuntimeContainer(
      createDeployRequest({
        routeHost: 'smoke-web.apps.localhost',
        run: createRun({
          restart: {
            policy: 'unless-stopped',
          },
        }),
      }),
      createRuntimeDeployConfig(),
    );

    expect(mocks.runDockerContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        restartPolicy: {
          name: 'unless-stopped',
        },
      }),
    );
  });

  it('starts a new candidate on a fresh route port when a previous deployment is active', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31001);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValue(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'candidate_container_123' });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    const response: NodeDeployResponse = await deployRuntimeContainer(
      createDeployRequest({
        deploymentId: 'dep_abcdef123456',
        previousDeployment: {
          upstreamPort: 31000,
        },
      }),
      createRuntimeDeployConfig(),
    );

    expect(response.containerId).toBe('candidate_container_123');
    expect(response.upstreamHost).toBe('127.0.0.1');
    expect(response.upstreamPort).toBe(31001);
    expect(mocks.findAvailablePort).toHaveBeenCalledWith(31000, 31010, [31000], '127.0.0.1');
    expect(mocks.removeDockerContainer).not.toHaveBeenCalledWith({
      containerRef: 'previous_container_123',
    });
  });

  it('uses the internal docker network without publishing runtime ports in network mode', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
        serviceId: 'svc_web',
      },
      'compartment-e2e',
    );
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeNetworkForDeployment.mockResolvedValueOnce(networkName);
    mocks.resolveRuntimeNetworkActors.mockResolvedValueOnce({ caddyContainerId: 'caddy_container' });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.runDockerContainerToCompletion.mockResolvedValueOnce({
      containerId: 'probe_container_123',
      logs: [],
      stderr: '',
      stdout: '',
    });

    const response: NodeDeployResponse = await deployRuntimeContainer(
      createDeployRequest(),
      createRuntimeDeployConfig({
        runtimeConnectivityMode: 'network',
        runtimeDefaultUpstreamHost: 'host.docker.internal',
      }),
    );

    expect(response.upstreamHost).toBe('compartment-compartment-e2e-smoke-web-production-web-dep-123456');
    expect(response.upstreamPort).toBe(3000);
    expect(mocks.findAvailablePort).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeNetworkForDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        dockerNamespace: 'compartment-e2e',
        runtimeConnectivityMode: 'network',
      }),
      expect.objectContaining({
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
        serviceId: 'svc_web',
      }),
    );
    expect(mocks.removeDockerContainer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureRuntimeNetworkForDeployment.mock.invocationCallOrder[0]!,
    );
    expect(mocks.syncRuntimeNetworkEgressDenyRules).not.toHaveBeenCalled();
    expect(mocks.runDockerContainer).toHaveBeenCalledWith({
      containerName: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
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
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.service': 'web',
        'compartment.serviceId': 'svc_web',
        'compartment.upstreamHost': 'compartment-compartment-e2e-smoke-web-production-web-dep-123456',
        'compartment.upstreamPort': '3000',
      },
      network: {
        aliases: ['compartment-compartment-e2e-smoke-web-production-web-dep-123456'],
        name: networkName,
      },
      restartPolicy: {
        name: 'on-failure',
      },
      securityProfile: runtimeContainerSecurityProfile,
    });
    expect(mocks.waitForHealthyRuntime).not.toHaveBeenCalled();
    const probeInput: DockerRunContainerInput = readRuntimeReadinessProbeInput();
    expect(probeInput.env.COMPARTMENT_READINESS_HOST_HEADER).toBe(
      'compartment-compartment-e2e-smoke-web-production-web-dep-123456:3000',
    );
    expect(probeInput.env.COMPARTMENT_READINESS_URL).toBe(
      'http://compartment-compartment-e2e-smoke-web-production-web-dep-123456:3000/healthz',
    );
    expect(probeInput.imageRef).toBe('ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0');
    expect(probeInput.network).toEqual({ name: networkName });
  });

  it('connects the resource network only when runtime intent requires resource outputs', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
        serviceId: 'svc_web',
      },
      'compartment-e2e',
    );
    const resourceNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
      },
      'compartment-e2e',
    );
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeNetworkForDeployment.mockResolvedValueOnce(networkName);
    mocks.ensureRuntimeResourceNetwork.mockResolvedValueOnce(resourceNetworkName);
    mocks.resolveRuntimeNetworkActors.mockResolvedValueOnce({ caddyContainerId: 'caddy_container' });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.runDockerContainerToCompletion.mockResolvedValueOnce({
      containerId: 'probe_container_123',
      logs: [],
      stderr: '',
      stdout: '',
    });

    await deployRuntimeContainer(
      createDeployRequest({
        runtimeNetwork: {
          requiresResourceNetwork: true,
        },
      }),
      createRuntimeDeployConfig({
        runtimeConnectivityMode: 'network',
        runtimeDefaultUpstreamHost: 'host.docker.internal',
      }),
    );

    expect(mocks.ensureRuntimeResourceNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
      }),
      expect.objectContaining({ dockerNamespace: 'compartment-e2e' }),
    );
    expect(mocks.syncRuntimeNetworkEgressDenyRules).toHaveBeenCalledWith({
      dockerNamespace: 'compartment-e2e',
      networkNames: [networkName, resourceNetworkName],
      platformSourceContainerRefs: ['caddy_container'],
    });
    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
      networkName: resourceNetworkName,
    });
  });

  it('preserves runtime network errors instead of wrapping them as deployment readiness failures', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
        serviceId: 'svc_web',
      },
      'compartment-e2e',
    );
    const capacityError: Error = createRuntimeNetworkCapacityExhaustedError('No subnet remains.');
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.ensureRuntimeNetworkForDeployment.mockResolvedValueOnce(networkName);
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.ensureRuntimeResourceNetwork.mockRejectedValueOnce(capacityError);

    let failure: Error | undefined;
    try {
      await deployRuntimeContainer(
        createDeployRequest({
          runtimeNetwork: {
            requiresResourceNetwork: true,
          },
        }),
        createRuntimeDeployConfig({
          runtimeConnectivityMode: 'network',
          runtimeDefaultUpstreamHost: 'host.docker.internal',
        }),
      );
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toBe(capacityError);
    expect(isNodeRuntimeError(failure)).toBe(true);
    expect(failure?.message).not.toContain('runtime readiness failed');
    expect(mocks.removeDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
    });
  });

  it('preserves the readiness failure when cleanup removal also fails', async (): Promise<void> => {
    mocks.findAvailablePort.mockResolvedValueOnce(31000);
    mocks.inspectDockerImage.mockResolvedValueOnce({
      exposedPorts: [3000],
      imageRef: 'sha256:image',
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'container_123' });
    mocks.waitForHealthyRuntime.mockRejectedValueOnce(new Error('not ready'));
    mocks.removeDockerContainer.mockRejectedValueOnce(new Error('docker remove failed'));

    let failure: Error | undefined;
    try {
      await deployRuntimeContainer(createDeployRequest(), createRuntimeDeployConfig());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toContain('runtime readiness failed: not ready');
    expect(isNodeRuntimeError(failure)).toBe(true);
    if (isNodeRuntimeError(failure)) {
      expect(failure.code).toBe(nodeRuntimeServiceReadinessFailedErrorCode);
    }

    expect(mocks.removeDockerContainer).toHaveBeenNthCalledWith(2, {
      containerRef: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
    });
    expect(mocks.removeDockerContainer).toHaveBeenNthCalledWith(3, {
      containerRef: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
    });
  });
});

describe('tailRuntimeContainerLogs', (): void => {
  it('returns an empty log response when the runtime container is missing', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce(null);

    const response: NodeTailLogsResponse = await tailRuntimeContainerLogs({
      containerId: 'container_missing',
      deploymentId: 'dep_123',
      environmentName: 'production',
      serviceName: 'web',
    });

    expect(response.lines).toEqual([]);
    expect(mocks.inspectDockerContainer).toHaveBeenCalledWith({
      containerRef: 'container_missing',
    });
    expect(mocks.tailDockerContainerLogs).not.toHaveBeenCalled();
  });

  it('preserves docker log streams in deployment log lines and filters by since', async (): Promise<void> => {
    mocks.tailDockerContainerLogs.mockResolvedValueOnce({
      lines: [
        {
          message: 'old line',
          stream: 'stdout',
          timestamp: '2026-03-23T11:59:59.000000000Z',
        },
        {
          message: 'boot complete',
          stream: 'stdout',
          timestamp: '2026-03-23T12:00:00.000000000Z',
        },
        {
          message: 'traceback line',
          stream: 'stderr',
          timestamp: '2026-03-23T12:00:01.000000000Z',
        },
      ],
    });
    const response: NodeTailLogsResponse = await tailRuntimeContainerLogs({
      containerId: 'container_123',
      deploymentId: 'dep_123',
      environmentName: 'production',
      serviceName: 'web',
      since: '2026-03-23T12:00:00.000Z',
    });

    expect(response.lines).toHaveLength(2);
    expect(response.lines[0]?.message).toBe('boot complete');
    expect(response.lines[0]?.stream).toBe('stdout');
    expect(response.lines[1]?.message).toBe('traceback line');
    expect(response.lines[1]?.stream).toBe('stderr');
    expect(mocks.tailDockerContainerLogs).toHaveBeenCalledWith({
      containerId: 'container_123',
      since: '2026-03-23T12:00:00.000Z',
    });
  });

  it('defaults one-shot runtime log reads to the last 100 lines', async (): Promise<void> => {
    mocks.tailDockerContainerLogs.mockResolvedValueOnce({
      lines: [],
    });

    await tailRuntimeContainerLogs({
      containerId: 'container_123',
      deploymentId: 'dep_123',
      environmentName: 'production',
      serviceName: 'web',
    });

    expect(mocks.tailDockerContainerLogs).toHaveBeenCalledWith({
      containerId: 'container_123',
      tailLines: 100,
    });
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
          stream: 'stdout',
          timestamp: '2026-03-23T12:00:00.123456790Z',
        },
      ],
    });

    const response: NodeTailLogsResponse = await tailRuntimeContainerLogs({
      containerId: 'container_123',
      deploymentId: 'dep_123',
      environmentName: 'production',
      serviceName: 'web',
      since: '2026-03-23T12:00:00.123456789Z',
    });

    expect(response.lines).toHaveLength(1);
    expect(response.lines[0]?.message).toBe('newer within the same millisecond');
    expect(mocks.tailDockerContainerLogs).toHaveBeenCalledWith({
      containerId: 'container_123',
      since: '2026-03-23T12:00:00.123456789Z',
    });
  });
});

describe('stopRuntimeContainer', (): void => {
  it('removes the addressed runtime container even when network reconciliation fails', async (): Promise<void> => {
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.reconcileRuntimeNetworks.mockRejectedValueOnce(new Error('caddy unavailable'));
    const config: NodeConfig = createNodeConfig();

    const response: NodeStopDeploymentResponse = await stopRuntimeContainer(
      {
        containerId: 'container_123',
      },
      config,
    );

    expect(response.stoppedAt).toContain('T');
    expect(mocks.removeDockerContainer).toHaveBeenCalledWith({
      containerRef: 'container_123',
    });
    expect(mocks.reconcileRuntimeNetworks).toHaveBeenCalledWith(config, {
      disconnectCaddyStaleNetworks: true,
    });
  });
});

describe('drainRuntimeContainer', (): void => {
  it('removes the addressed draining container even when network reconciliation fails', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'previous_container_123',
      imageRef: 'sha256:previous-image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_previous',
      },
      publishedPorts: [],
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.reconcileRuntimeNetworks.mockRejectedValueOnce(new Error('caddy unavailable'));
    const config: NodeConfig = createNodeConfig();

    const response: NodeDrainDeploymentResponse = await drainRuntimeContainer(
      {
        containerId: 'previous_container_123',
        deploymentId: 'dep_previous',
      },
      config,
    );

    expect(response.acceptedAt).toContain('T');
    expect(mocks.inspectDockerContainer).toHaveBeenCalledWith({
      containerRef: 'previous_container_123',
    });
    expect(mocks.removeDockerContainer).toHaveBeenCalledWith({
      containerRef: 'previous_container_123',
    });
    expect(mocks.reconcileRuntimeNetworks).toHaveBeenCalledWith(config, {
      disconnectCaddyStaleNetworks: true,
    });
  });

  it('skips removal when the draining container is already gone', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce(null);

    const response: NodeDrainDeploymentResponse = await drainRuntimeContainer(
      {
        containerId: 'previous_container_123',
        deploymentId: 'dep_previous',
      },
      createNodeConfig(),
    );

    expect(response.acceptedAt).toContain('T');
    expect(mocks.removeDockerContainer).not.toHaveBeenCalled();
  });

  it('rejects removal when the container belongs to another deployment', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'previous_container_123',
      imageRef: 'sha256:previous-image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_other',
      },
      publishedPorts: [],
    });

    await expect(
      drainRuntimeContainer(
        {
          containerId: 'previous_container_123',
          deploymentId: 'dep_previous',
        },
        createNodeConfig(),
      ),
    ).rejects.toThrow('does not belong to deployment dep_previous');

    expect(mocks.removeDockerContainer).not.toHaveBeenCalled();
  });
});

function readRuntimeReadinessProbeInput(): DockerRunContainerInput {
  const probeInput: DockerRunContainerInput | undefined = mocks.runDockerContainerToCompletion.mock.calls[0]?.[0];
  if (probeInput === undefined) {
    throw new Error('Expected runtime readiness probe container input.');
  }

  return probeInput;
}
