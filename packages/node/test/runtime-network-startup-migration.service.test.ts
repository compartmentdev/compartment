import type {
  DockerInspectContainerResult,
  DockerInspectNetworkResult,
  DockerListNetworkResult,
} from '@compartment/docker';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { migrateLegacyRuntimeNetworksOnStartup } from '../src/services/runtime-network-startup-migration.service';
import { buildRuntimeResourceNetworkName, buildRuntimeServiceNetworkName } from '../src/services/runtime-names.service';
import type { RuntimeNetworkPoolConfig } from '../src/services/runtime.types';
import {
  buildTestIpv4Address,
  buildTestIpv4Cidr,
  createRuntimeNetworkPoolConfig,
} from './runtime-network-pool.fixture';

interface DockerConnectContainerToNetworkInput {
  aliases?: string[] | undefined;
  containerRef: string;
  networkName: string;
}

interface DockerDisconnectContainerFromNetworkInput {
  containerRef: string;
  networkName: string;
}

interface DockerEnsureNetworkInput {
  ipam?: { subnet: string } | undefined;
  labels: Record<string, string>;
  networkName: string;
}

type ConnectDockerContainerToNetwork = (input: DockerConnectContainerToNetworkInput) => Promise<void>;
type DisconnectDockerContainerFromNetwork = (input: DockerDisconnectContainerFromNetworkInput) => Promise<void>;
type EnsureDockerNetwork = (input: DockerEnsureNetworkInput) => Promise<void>;
type ExecFile = (file: string, args: string[], callback: ExecFileCallback) => void;
type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResult | null>;
type InspectDockerNetwork = (input: { networkName: string }) => Promise<DockerInspectNetworkResult | null>;
type ListDockerNetworks = () => Promise<DockerListNetworkResult[]>;
type ReadDockerEngineErrorMessage = (error: Error) => string;
type RemoveDockerNetwork = (input: { networkName: string }) => Promise<void>;

interface StartupMigrationMocks {
  connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
  disconnectDockerContainerFromNetwork: Mock<DisconnectDockerContainerFromNetwork>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  execFile: Mock<ExecFile>;
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  listDockerNetworks: Mock<ListDockerNetworks>;
  readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
  removeDockerNetwork: Mock<RemoveDockerNetwork>;
}

interface StartupMigrationConfigFixture {
  dockerNamespace: string;
  runtimeConnectivityMode: 'network';
  runtimeNetworkPool: RuntimeNetworkPoolConfig;
}

const mocks: StartupMigrationMocks = vi.hoisted(
  (): StartupMigrationMocks => ({
    connectDockerContainerToNetwork: vi.fn<ConnectDockerContainerToNetwork>(),
    disconnectDockerContainerFromNetwork: vi.fn<DisconnectDockerContainerFromNetwork>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    execFile: vi.fn<ExecFile>(),
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    listDockerNetworks: vi.fn<ListDockerNetworks>(),
    readDockerEngineErrorMessage: vi.fn<ReadDockerEngineErrorMessage>(),
    removeDockerNetwork: vi.fn<RemoveDockerNetwork>(),
  }),
);

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

vi.mock('node:child_process', (): { execFile: Mock<ExecFile> } => ({
  execFile: mocks.execFile,
}));

vi.mock(
  '@compartment/docker',
  (): {
    buildDockerNamespaceLabels: (namespace: string) => Record<string, string>;
    compartmentDockerNamespaceLabelName: string;
    connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
    disconnectDockerContainerFromNetwork: Mock<DisconnectDockerContainerFromNetwork>;
    ensureDockerNetwork: Mock<EnsureDockerNetwork>;
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
    listDockerNetworks: Mock<ListDockerNetworks>;
    readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
    removeDockerNetwork: Mock<RemoveDockerNetwork>;
  } => ({
    buildDockerNamespaceLabels: (namespace: string): Record<string, string> => ({
      'compartment.namespace': namespace,
    }),
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    connectDockerContainerToNetwork: mocks.connectDockerContainerToNetwork,
    disconnectDockerContainerFromNetwork: mocks.disconnectDockerContainerFromNetwork,
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
    listDockerNetworks: mocks.listDockerNetworks,
    readDockerEngineErrorMessage: mocks.readDockerEngineErrorMessage,
    removeDockerNetwork: mocks.removeDockerNetwork,
  }),
);

beforeEach((): void => {
  mocks.execFile.mockImplementation((_file: string, _args: string[], callback: ExecFileCallback): void => {
    callback(null, '', '');
  });
  mocks.readDockerEngineErrorMessage.mockImplementation((error: Error): string => error.message);
});

afterEach((): void => {
  mocks.connectDockerContainerToNetwork.mockReset();
  mocks.disconnectDockerContainerFromNetwork.mockReset();
  mocks.ensureDockerNetwork.mockReset();
  mocks.execFile.mockReset();
  mocks.inspectDockerContainer.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.listDockerNetworks.mockReset();
  mocks.readDockerEngineErrorMessage.mockReset();
  mocks.removeDockerNetwork.mockReset();
});

describe('migrateLegacyRuntimeNetworksOnStartup', (): void => {
  it('replaces active name-based legacy service networks with managed canonical networks', async (): Promise<void> => {
    const dockerNamespace: string = 'test';
    const legacyNetworkName: string = 'compartment-test-smoke-web-production-web';
    const managedNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
        serviceId: 'svc_123',
      },
      dockerNamespace,
    );
    const legacyNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: ['container_123'],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(172, 20, 0, 0, 16),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: legacyNetworkName,
    };
    const runtimeContainer: DockerInspectContainerResult = {
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123',
        'compartment.environmentId': 'env_123',
        'compartment.projectId': 'prj_123',
        'compartment.serviceId': 'svc_123',
        'compartment.upstreamHost': 'upstream-dep-123',
      },
      publishedPorts: [],
    };
    mocks.listDockerNetworks.mockResolvedValue([toListedNetwork(legacyNetwork)]);
    mocks.inspectDockerNetwork.mockResolvedValue(legacyNetwork);
    mocks.inspectDockerContainer.mockResolvedValue(runtimeContainer);

    await migrateLegacyRuntimeNetworksOnStartup(createConfig(dockerNamespace));

    expect(mocks.disconnectDockerContainerFromNetwork).toHaveBeenCalledWith({
      containerRef: 'container_123',
      networkName: legacyNetworkName,
    });
    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: legacyNetworkName });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
        networkName: managedNetworkName,
      }),
    );
    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      aliases: ['upstream-dep-123'],
      containerRef: 'container_123',
      networkName: managedNetworkName,
    });
  });

  it('allocates a non-overlapping replacement subnet while a renamed legacy network still exists', async (): Promise<void> => {
    const dockerNamespace: string = 'test';
    const legacyNetworkName: string = 'compartment-test-smoke-web-production-web';
    const managedNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
        serviceId: 'svc_123',
      },
      dockerNamespace,
    );
    const legacyNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: ['container_123'],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: legacyNetworkName,
    };
    mocks.listDockerNetworks.mockResolvedValue([toListedNetwork(legacyNetwork)]);
    mocks.inspectDockerNetwork.mockResolvedValue(legacyNetwork);
    mocks.inspectDockerContainer.mockResolvedValue({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123',
        'compartment.environmentId': 'env_123',
        'compartment.projectId': 'prj_123',
        'compartment.serviceId': 'svc_123',
      },
      publishedPorts: [],
    });

    await migrateLegacyRuntimeNetworksOnStartup(createConfig(dockerNamespace));

    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 16, 28) },
        networkName: managedNetworkName,
      }),
    );
  });

  it('migrates legacy resource networks with service consumers as one resource network', async (): Promise<void> => {
    const dockerNamespace: string = 'test';
    const legacyNetworkName: string = 'compartment-test-smoke-production-resources';
    const managedNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
      },
      dockerNamespace,
    );
    const legacyNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: ['resource_container_123', 'service_container_123'],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(172, 20, 0, 0, 16),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: legacyNetworkName,
    };
    mocks.listDockerNetworks.mockResolvedValue([toListedNetwork(legacyNetwork)]);
    mocks.inspectDockerNetwork.mockResolvedValue(legacyNetwork);
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: { containerRef: string }): Promise<DockerInspectContainerResult | null> => {
        await Promise.resolve();
        if (containerRef === 'resource_container_123') {
          return {
            containerId: 'resource_container_123',
            imageRef: 'sha256:resource-image',
            isRunning: true,
            labels: {
              'compartment.environment': 'production',
              'compartment.environmentId': 'env_123',
              'compartment.project': 'smoke',
              'compartment.projectId': 'prj_123',
              'compartment.resource': 'postgres',
            },
            networkAttachments: [
              {
                aliases: ['postgres.resource.internal', 'compartment-test-smoke-production-resource-postgres'],
                ipAddress: buildTestIpv4Address(172, 20, 0, 2),
                name: legacyNetworkName,
              },
            ],
            publishedPorts: [],
          };
        }

        return {
          containerId: 'service_container_123',
          imageRef: 'sha256:service-image',
          isRunning: true,
          labels: {
            'compartment.deploymentId': 'dep_123',
            'compartment.environmentId': 'env_123',
            'compartment.projectId': 'prj_123',
            'compartment.serviceId': 'svc_123',
            'compartment.upstreamHost': 'upstream-dep-123',
          },
          networkAttachments: [
            {
              aliases: ['service-resource-client'],
              ipAddress: buildTestIpv4Address(172, 20, 0, 3),
              name: legacyNetworkName,
            },
          ],
          publishedPorts: [],
        };
      },
    );

    await migrateLegacyRuntimeNetworksOnStartup(createConfig(dockerNamespace));

    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
        networkName: managedNetworkName,
      }),
    );
    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      aliases: ['postgres.resource.internal', 'compartment-test-smoke-production-resource-postgres'],
      containerRef: 'resource_container_123',
      networkName: managedNetworkName,
    });
    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      aliases: ['service-resource-client'],
      containerRef: 'service_container_123',
      networkName: managedNetworkName,
    });
  });

  it('removes stale legacy networks that only have non-runtime endpoints', async (): Promise<void> => {
    const dockerNamespace: string = 'test';
    const legacyNetworkName: string = 'compartment-test-smoke-production-old-service';
    const legacyNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: ['caddy_container_123'],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(172, 20, 0, 0, 16),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: legacyNetworkName,
    };
    mocks.listDockerNetworks.mockResolvedValue([toListedNetwork(legacyNetwork)]);
    mocks.inspectDockerNetwork.mockResolvedValue(legacyNetwork);
    mocks.inspectDockerContainer.mockResolvedValue({
      containerId: 'caddy_container_123',
      imageRef: 'sha256:caddy',
      isRunning: true,
      labels: {
        'compartment.role': 'caddy',
      },
      publishedPorts: [],
    });

    await migrateLegacyRuntimeNetworksOnStartup(createConfig(dockerNamespace));

    expect(mocks.disconnectDockerContainerFromNetwork).toHaveBeenCalledWith({
      containerRef: 'caddy_container_123',
      networkName: legacyNetworkName,
    });
    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: legacyNetworkName });
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
  });

  it('does not detach legacy participants when managed replacement creation fails first', async (): Promise<void> => {
    const dockerNamespace: string = 'test';
    const legacyNetworkName: string = 'compartment-test-smoke-web-production-web';
    const legacyNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: ['container_123'],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(172, 20, 0, 0, 16),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: legacyNetworkName,
    };
    mocks.listDockerNetworks.mockResolvedValue([toListedNetwork(legacyNetwork)]);
    mocks.inspectDockerNetwork.mockResolvedValue(legacyNetwork);
    mocks.inspectDockerContainer.mockResolvedValue({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123',
        'compartment.environmentId': 'env_123',
        'compartment.projectId': 'prj_123',
        'compartment.serviceId': 'svc_123',
      },
      publishedPorts: [],
    });
    mocks.ensureDockerNetwork.mockRejectedValue(new Error('Docker create failed'));

    await expect(migrateLegacyRuntimeNetworksOnStartup(createConfig(dockerNamespace))).rejects.toThrow(
      'Docker create failed',
    );

    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
  });
});

function createConfig(dockerNamespace: string): StartupMigrationConfigFixture {
  return {
    dockerNamespace,
    runtimeConnectivityMode: 'network',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
  };
}

function toListedNetwork(network: DockerInspectNetworkResult): DockerListNetworkResult {
  return {
    ipamConfigs: network.ipamConfigs,
    labels: network.labels,
    name: network.name,
  };
}
