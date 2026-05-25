import { createServer, type AddressInfo, type Server } from 'node:net';
import type {
  DockerContainerSecurityProfile,
  DockerInspectContainerResult,
  DockerInspectNetworkResult,
  DockerListContainerResult,
  DockerListNetworkResult,
  DockerRunContainerInput,
  DockerRunContainerResult,
} from '@compartment/docker';
import type { NodeResourceDeleteRequest, NodeResourceRequest, NodeResourceResponse } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { reconcileRuntimeResource, startRuntimeResource } from '../src/services/runtime-resource.service';
import { deleteRuntimeResource } from '../src/services/runtime-resource-lifecycle.service';
import { buildRuntimeResourceLabels } from '../src/services/runtime-resource-labels';
import type { RuntimeDeployConfig } from '../src/services/runtime.types';

type BuildDockerNamespaceLabels = (namespace: string) => Record<string, string>;
type ConnectDockerContainerToNetwork = (input: { containerRef: string; networkName: string }) => Promise<void>;
type DisconnectDockerContainerFromNetwork = (input: { containerRef: string; networkName: string }) => Promise<void>;
type EnsureDockerImageAvailable = (input: { imageRef: string }) => Promise<void>;
type EnsureDockerNetwork = (input: { labels: Record<string, string>; networkName: string }) => Promise<void>;
type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResult | null>;
type InspectDockerNetwork = (input: { networkName: string }) => Promise<DockerInspectNetworkResult | null>;
type ListDockerContainers = (input?: {
  labelFilters?: Record<string, string | undefined>;
}) => Promise<DockerListContainerResult[]>;
type ListDockerNetworks = () => Promise<DockerListNetworkResult[]>;
type RemoveDockerContainer = (input: { containerRef: string }) => Promise<void>;
type RemoveDockerNetwork = (input: { networkName: string }) => Promise<void>;
type RemoveDockerVolume = (input: { volumeName: string }) => Promise<void>;
type RenameDockerContainer = (input: { containerRef: string; nextContainerName: string }) => Promise<void>;
type RunDockerContainer = (input: DockerRunContainerInput) => Promise<DockerRunContainerResult>;
type StartDockerContainer = (input: { containerRef: string }) => Promise<void>;
type StopDockerContainer = (input: { containerRef: string }) => Promise<void>;
type SyncDockerNetworkEgressDenyRules = (input: {
  destinationCidrs: string[];
  namespace: string;
  sourceSubnets: string[];
}) => Promise<void>;

interface TestNodeResourceRuntimeDefinition {
  command: string[];
  env: TestNodeResourceEnvValue[];
  image: string;
  ports: number[];
  readiness: TestNodeResourceReadiness | null;
  restart: TestNodeResourceRestart;
}

interface TestNodeResourceEnvValue {
  keyName: string;
  value: string;
}

interface TestNodeResourceReadiness {
  port: number;
  timeoutMs: number;
  type: 'tcp';
}

interface TestNodeResourceRestart {
  policy: 'no' | 'on-failure' | 'unless-stopped';
}

interface RuntimeResourceServiceMocks {
  buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
  connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
  disconnectDockerContainerFromNetwork: Mock<DisconnectDockerContainerFromNetwork>;
  ensureDockerImageAvailable: Mock<EnsureDockerImageAvailable>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  listDockerContainers: Mock<ListDockerContainers>;
  listDockerNetworks: Mock<ListDockerNetworks>;
  removeDockerContainer: Mock<RemoveDockerContainer>;
  removeDockerNetwork: Mock<RemoveDockerNetwork>;
  removeDockerVolume: Mock<RemoveDockerVolume>;
  renameDockerContainer: Mock<RenameDockerContainer>;
  runDockerContainer: Mock<RunDockerContainer>;
  startDockerContainer: Mock<StartDockerContainer>;
  stopDockerContainer: Mock<StopDockerContainer>;
  syncDockerNetworkEgressDenyRules: Mock<SyncDockerNetworkEgressDenyRules>;
}

const mocks: RuntimeResourceServiceMocks = vi.hoisted(
  (): RuntimeResourceServiceMocks => ({
    buildDockerNamespaceLabels: vi.fn<BuildDockerNamespaceLabels>(
      (namespace: string): Record<string, string> => ({
        'compartment.namespace': namespace,
      }),
    ),
    connectDockerContainerToNetwork: vi.fn<ConnectDockerContainerToNetwork>(),
    disconnectDockerContainerFromNetwork: vi.fn<DisconnectDockerContainerFromNetwork>(),
    ensureDockerImageAvailable: vi.fn<EnsureDockerImageAvailable>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    listDockerContainers: vi.fn<ListDockerContainers>(),
    listDockerNetworks: vi.fn<ListDockerNetworks>(),
    removeDockerContainer: vi.fn<RemoveDockerContainer>(),
    removeDockerNetwork: vi.fn<RemoveDockerNetwork>(),
    removeDockerVolume: vi.fn<RemoveDockerVolume>(),
    renameDockerContainer: vi.fn<RenameDockerContainer>(),
    runDockerContainer: vi.fn<RunDockerContainer>(),
    startDockerContainer: vi.fn<StartDockerContainer>(),
    stopDockerContainer: vi.fn<StopDockerContainer>(),
    syncDockerNetworkEgressDenyRules: vi.fn<SyncDockerNetworkEgressDenyRules>(),
  }),
);

vi.mock(
  '@compartment/docker',
  (): {
    buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
    compartmentDockerNamespaceLabelName: string;
    connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
    disconnectDockerContainerFromNetwork: Mock<DisconnectDockerContainerFromNetwork>;
    ensureDockerImageAvailable: Mock<EnsureDockerImageAvailable>;
    ensureDockerNetwork: Mock<EnsureDockerNetwork>;
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
    listDockerContainers: Mock<ListDockerContainers>;
    listDockerNetworks: Mock<ListDockerNetworks>;
    removeDockerContainer: Mock<RemoveDockerContainer>;
    removeDockerNetwork: Mock<RemoveDockerNetwork>;
    removeDockerVolume: Mock<RemoveDockerVolume>;
    renameDockerContainer: Mock<RenameDockerContainer>;
    runDockerContainer: Mock<RunDockerContainer>;
    startDockerContainer: Mock<StartDockerContainer>;
    stopDockerContainer: Mock<StopDockerContainer>;
    syncDockerNetworkEgressDenyRules: Mock<SyncDockerNetworkEgressDenyRules>;
  } => ({
    buildDockerNamespaceLabels: mocks.buildDockerNamespaceLabels,
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    connectDockerContainerToNetwork: mocks.connectDockerContainerToNetwork,
    disconnectDockerContainerFromNetwork: mocks.disconnectDockerContainerFromNetwork,
    ensureDockerImageAvailable: mocks.ensureDockerImageAvailable,
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
    listDockerContainers: mocks.listDockerContainers,
    listDockerNetworks: mocks.listDockerNetworks,
    removeDockerContainer: mocks.removeDockerContainer,
    removeDockerNetwork: mocks.removeDockerNetwork,
    removeDockerVolume: mocks.removeDockerVolume,
    renameDockerContainer: mocks.renameDockerContainer,
    runDockerContainer: mocks.runDockerContainer,
    startDockerContainer: mocks.startDockerContainer,
    stopDockerContainer: mocks.stopDockerContainer,
    syncDockerNetworkEgressDenyRules: mocks.syncDockerNetworkEgressDenyRules,
  }),
);

const resourceContainerSecurityProfile: DockerContainerSecurityProfile = {
  capabilityAdditions: {
    add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
    reason:
      'User resource images can use root entrypoints to repair persistent volume ownership and permissions, then drop privileges.',
  },
  name: 'restricted-writable',
  writableRootFilesystemReason: 'Resource images can require writable runtime paths outside declared data volumes.',
};

const nodeContainerRef: string = 'node_container_123';
const originalHostname: string | undefined = process.env.HOSTNAME;

beforeEach((): void => {
  process.env.HOSTNAME = nodeContainerRef;
});

afterEach((): void => {
  if (originalHostname === undefined) {
    delete process.env.HOSTNAME;
  } else {
    process.env.HOSTNAME = originalHostname;
  }
  mocks.buildDockerNamespaceLabels.mockClear();
  mocks.connectDockerContainerToNetwork.mockReset();
  mocks.disconnectDockerContainerFromNetwork.mockReset();
  mocks.ensureDockerImageAvailable.mockReset();
  mocks.ensureDockerNetwork.mockReset();
  mocks.inspectDockerContainer.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.listDockerContainers.mockReset();
  mocks.listDockerNetworks.mockReset();
  mocks.removeDockerContainer.mockReset();
  mocks.removeDockerNetwork.mockReset();
  mocks.removeDockerVolume.mockReset();
  mocks.renameDockerContainer.mockReset();
  mocks.runDockerContainer.mockReset();
  mocks.startDockerContainer.mockReset();
  mocks.stopDockerContainer.mockReset();
  mocks.syncDockerNetworkEgressDenyRules.mockReset();
});

describe('reconcileRuntimeResource', (): void => {
  it('replaces the resource container and starts it on the internal network only', async (): Promise<void> => {
    mocks.ensureDockerImageAvailable.mockResolvedValueOnce(undefined);
    mocks.removeDockerContainer.mockResolvedValue(undefined);
    mocks.renameDockerContainer.mockResolvedValue(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'resource_container_123' });
    mocks.stopDockerContainer.mockResolvedValueOnce(undefined);
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_old',
      imageRef: 'postgres:15',
      isRunning: true,
      labels: {},
      publishedPorts: [],
    });
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_123',
      imageRef: 'postgres:16',
      isRunning: true,
      labels: {},
      publishedPorts: [],
    });

    const response: NodeResourceResponse = await reconcileRuntimeResource(
      createResourceRequest(),
      createRuntimeDeployConfig(),
    );

    expect(response).toEqual({
      containerId: 'resource_container_123',
      hostname: 'postgres.production.smoke.local',
      status: 'running',
    });
    expect(mocks.renameDockerContainer).toHaveBeenNthCalledWith(1, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres',
      nextContainerName: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
    });
    expect(mocks.stopDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
    });
    expect(mocks.removeDockerContainer).toHaveBeenNthCalledWith(1, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
    });
    expect(mocks.removeDockerContainer).toHaveBeenNthCalledWith(2, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
    });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith({
      labels: {
        'compartment.namespace': 'compartment-e2e',
      },
      networkName: 'compartment-compartment-e2e-prj-smoke-env-production-resources',
    });
    expect(mocks.runDockerContainer).toHaveBeenCalledWith({
      containerName: 'compartment-compartment-e2e-smoke-production-resource-postgres',
      env: {
        POSTGRES_DB: 'app',
        POSTGRES_PASSWORD: 'secret',
      },
      imageRef: 'postgres:16',
      labels: createResourceLabels(),
      namedVolumes: [
        {
          labels: createResourceLabels(),
          name: 'compartment-compartment-e2e-smoke-production-resource-postgres-data',
          targetPath: '/var/lib/postgresql/data',
        },
      ],
      network: {
        aliases: ['postgres.production.smoke.local', 'compartment-compartment-e2e-smoke-production-resource-postgres'],
        name: 'compartment-compartment-e2e-prj-smoke-env-production-resources',
      },
      restartPolicy: {
        name: 'unless-stopped',
      },
      securityProfile: resourceContainerSecurityProfile,
    });
  });

  it('restores the previous resource container when replacement startup fails', async (): Promise<void> => {
    mocks.ensureDockerImageAvailable.mockResolvedValueOnce(undefined);
    mocks.removeDockerContainer.mockResolvedValue(undefined);
    mocks.renameDockerContainer.mockResolvedValue(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'resource_container_123' });
    mocks.startDockerContainer.mockResolvedValueOnce(undefined);
    mocks.stopDockerContainer.mockResolvedValueOnce(undefined);
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_old',
      imageRef: 'postgres:15',
      isRunning: true,
      labels: {},
      publishedPorts: [],
    });
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_123',
      imageRef: 'postgres:16',
      isRunning: true,
      labels: {},
      networkAttachments: [
        {
          ipAddress: '127.0.0.1',
          name: 'compartment-compartment-e2e-prj-smoke-env-production-resources',
        },
      ],
      publishedPorts: [],
    });

    await expect(
      reconcileRuntimeResource(
        createResourceRequest({
          readiness: {
            port: 9,
            timeoutMs: 1,
            type: 'tcp',
          },
        }),
        createRuntimeDeployConfig(),
      ),
    ).rejects.toThrow('did not become ready');

    expect(mocks.renameDockerContainer).toHaveBeenNthCalledWith(1, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres',
      nextContainerName: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
    });
    expect(mocks.renameDockerContainer).toHaveBeenNthCalledWith(2, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
      nextContainerName: 'compartment-compartment-e2e-smoke-production-resource-postgres',
    });
    expect(mocks.stopDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
    });
    expect(mocks.startDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres',
    });
    expect(mocks.removeDockerContainer).toHaveBeenNthCalledWith(1, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
    });
    expect(mocks.removeDockerContainer).toHaveBeenNthCalledWith(2, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres',
    });
    expect(mocks.removeDockerContainer).toHaveBeenNthCalledWith(3, {
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres',
    });
  });

  it('restores an interrupted replacement backup before starting a new resource container', async (): Promise<void> => {
    mocks.ensureDockerImageAvailable.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'resource_container_123' });
    mocks.startDockerContainer.mockResolvedValueOnce(undefined);
    mocks.inspectDockerContainer.mockResolvedValueOnce(null);
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_old',
      imageRef: 'postgres:15',
      isRunning: false,
      labels: {},
      publishedPorts: [],
    });
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_123',
      imageRef: 'postgres:16',
      isRunning: true,
      labels: {},
      publishedPorts: [],
    });

    await expect(reconcileRuntimeResource(createResourceRequest(), createRuntimeDeployConfig())).resolves.toEqual({
      containerId: 'resource_container_123',
      hostname: 'postgres.production.smoke.local',
      status: 'running',
    });

    expect(mocks.renameDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres-previous',
      nextContainerName: 'compartment-compartment-e2e-smoke-production-resource-postgres',
    });
    expect(mocks.startDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres',
    });
  });
});

describe('startRuntimeResource', (): void => {
  it('waits for TCP readiness on the resource container network address', async (): Promise<void> => {
    const server: Server = await listenOnLocalPort();
    const address: AddressInfo | string | null = server.address();
    const port: number = typeof address === 'object' && address !== null ? address.port : 0;
    mocks.ensureDockerImageAvailable.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'resource_container_123' });
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_123',
      imageRef: 'postgres:16',
      isRunning: true,
      labels: {},
      networkAttachments: [
        {
          ipAddress: '127.0.0.1',
          name: 'compartment-compartment-e2e-prj-smoke-env-production-resources',
        },
      ],
      publishedPorts: [],
    });

    try {
      await expect(
        startRuntimeResource(
          createResourceRequest({
            readiness: {
              port,
              timeoutMs: 500,
              type: 'tcp',
            },
          }),
          createRuntimeDeployConfig(),
        ),
      ).resolves.toEqual({
        containerId: 'resource_container_123',
        hostname: 'postgres.production.smoke.local',
        status: 'running',
      });
    } finally {
      await closeServer(server);
    }

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
  });

  it('removes the resource container when TCP readiness times out', async (): Promise<void> => {
    mocks.ensureDockerImageAvailable.mockResolvedValueOnce(undefined);
    mocks.runDockerContainer.mockResolvedValueOnce({ containerId: 'resource_container_123' });
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'resource_container_123',
      imageRef: 'postgres:16',
      isRunning: true,
      labels: {},
      networkAttachments: [
        {
          ipAddress: '127.0.0.1',
          name: 'compartment-compartment-e2e-prj-smoke-env-production-resources',
        },
      ],
      publishedPorts: [],
    });
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);

    await expect(
      startRuntimeResource(
        createResourceRequest({
          readiness: {
            port: 9,
            timeoutMs: 1,
            type: 'tcp',
          },
        }),
        createRuntimeDeployConfig(),
      ),
    ).rejects.toThrow('did not become ready');

    expect(mocks.removeDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-production-resource-postgres',
    });
  });
});

describe('deleteRuntimeResource', (): void => {
  it('removes persisted resource volumes only when requested', async (): Promise<void> => {
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mocks.removeDockerVolume.mockResolvedValueOnce(undefined);
    mockRuntimeNetworkReconcileState();

    await expect(
      deleteRuntimeResource(
        {
          ...createResourceDeleteRequest(),
          deleteData: true,
        },
        createRuntimeDeployConfig(),
      ),
    ).resolves.toEqual({
      containerId: null,
      hostname: 'compartment-compartment-e2e-smoke-production-resource-postgres',
      status: 'stopped',
    });

    expect(mocks.removeDockerContainer).toHaveBeenCalledWith({
      containerRef: 'resource_container_123',
    });
    expect(mocks.removeDockerVolume).toHaveBeenCalledWith({
      volumeName: 'compartment-compartment-e2e-smoke-production-resource-postgres-data',
    });
    expect(mocks.listDockerContainers).toHaveBeenNthCalledWith(1, {
      labelFilters: {
        'com.docker.compose.project': 'compartment-e2e',
        'com.docker.compose.service': 'caddy',
      },
    });
  });

  it('retains persisted resource volumes by default', async (): Promise<void> => {
    mocks.removeDockerContainer.mockResolvedValueOnce(undefined);
    mockRuntimeNetworkReconcileState();

    await deleteRuntimeResource(createResourceDeleteRequest(), createRuntimeDeployConfig());

    expect(mocks.removeDockerVolume).not.toHaveBeenCalled();
  });

  it('deletes stopped resource volumes without a container ref fallback', async (): Promise<void> => {
    mocks.removeDockerVolume.mockResolvedValueOnce(undefined);
    mockRuntimeNetworkReconcileState();

    await expect(
      deleteRuntimeResource(
        {
          ...createResourceDeleteRequest(),
          containerId: null,
          deleteData: true,
        },
        createRuntimeDeployConfig(),
      ),
    ).resolves.toEqual({
      containerId: null,
      hostname: 'compartment-compartment-e2e-smoke-production-resource-postgres',
      status: 'stopped',
    });

    expect(mocks.removeDockerContainer).not.toHaveBeenCalled();
    expect(mocks.removeDockerVolume).toHaveBeenCalledWith({
      volumeName: 'compartment-compartment-e2e-smoke-production-resource-postgres-data',
    });
  });
});

function mockRuntimeNetworkReconcileState(): void {
  mocks.listDockerContainers
    .mockResolvedValueOnce([{ containerId: 'caddy_container', isRunning: true, labels: {} }])
    .mockResolvedValueOnce([]);
  mocks.inspectDockerContainer.mockResolvedValueOnce({
    containerId: 'caddy_container',
    imageRef: 'caddy:latest',
    isRunning: true,
    labels: {},
    networkAttachments: [{ ipAddress: null, name: 'compartment-e2e_system_internal' }],
    publishedPorts: [],
  });
  mocks.listDockerNetworks.mockResolvedValueOnce([]);
}

function createResourceRequest(overrides: Partial<TestNodeResourceRuntimeDefinition> = {}): NodeResourceRequest {
  return {
    definition: {
      command: [],
      env: [
        {
          keyName: 'POSTGRES_DB',
          value: 'app',
        },
        {
          keyName: 'POSTGRES_PASSWORD',
          value: 'secret',
        },
      ],
      image: 'postgres:16',
      ports: [5432],
      readiness: null,
      restart: {
        policy: 'unless-stopped',
      },
      ...overrides,
    },
    environmentId: 'env_production',
    environmentName: 'production',
    hostname: 'postgres.production.smoke.local',
    projectId: 'prj_smoke',
    projectName: 'smoke',
    resourceName: 'postgres',
    volumes: [
      {
        mountPath: '/var/lib/postgresql/data',
        name: 'data',
      },
    ],
  };
}

async function listenOnLocalPort(): Promise<Server> {
  const server: Server = createServer();
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => resolve());
  });
}

function createResourceDeleteRequest(): NodeResourceDeleteRequest {
  return {
    containerId: 'resource_container_123',
    environmentName: 'production',
    projectName: 'smoke',
    resourceName: 'postgres',
    volumes: [
      {
        mountPath: '/var/lib/postgresql/data',
        name: 'data',
      },
    ],
  };
}

function createResourceLabels(): Record<string, string> {
  return buildRuntimeResourceLabels('compartment-e2e', createResourceRequest());
}

function createRuntimeDeployConfig(): RuntimeDeployConfig {
  return {
    appPortEnd: 31010,
    appPortStart: 31000,
    dockerNamespace: 'compartment-e2e',
    runtimeConnectivityMode: 'network',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
  };
}
