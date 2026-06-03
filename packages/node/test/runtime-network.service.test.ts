import type {
  DockerInspectContainerResult,
  DockerInspectNetworkResult,
  DockerListContainerResult,
  DockerListNetworkResult,
  DockerListVolumeResult,
} from '@compartment/docker';
import type { NodeDeployRequest } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  buildRuntimeResourceNetworkName,
  buildRuntimeServiceNetworkName,
  buildSystemNetworkName,
} from '../src/services/runtime-names.service';
import { ensureRuntimeNetworkForDeployment, reconcileRuntimeNetworks } from '../src/services/runtime-network.service';
import type { RuntimeNetworkPoolConfig } from '../src/services/runtime.types';
import { createDeployRequest } from './runtime.service.fixtures';
import { buildTestIpv4Cidr, createRuntimeNetworkPoolConfig } from './runtime-network-pool.fixture';

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

interface DockerInspectContainerInput {
  containerRef: string;
}

interface DockerInspectNetworkInput {
  networkName: string;
}

interface DockerListContainersInput {
  all?: boolean | undefined;
  labelFilters?: Record<string, string | undefined> | undefined;
}

interface DockerRemoveNetworkInput {
  networkName: string;
}

type ConnectDockerContainerToNetwork = (input: DockerConnectContainerToNetworkInput) => Promise<void>;
type DisconnectDockerContainerFromNetwork = (input: DockerDisconnectContainerFromNetworkInput) => Promise<void>;
type EnsureDockerNetwork = (input: DockerEnsureNetworkInput) => Promise<void>;
type ExecFile = (file: string, args: string[], callback: ExecFileCallback) => void;
type InspectDockerContainer = (input: DockerInspectContainerInput) => Promise<DockerInspectContainerResult | null>;
type InspectDockerNetwork = (input: DockerInspectNetworkInput) => Promise<DockerInspectNetworkResult | null>;
type ListDockerContainers = (input: DockerListContainersInput) => Promise<DockerListContainerResult[]>;
type ListDockerNetworks = () => Promise<DockerListNetworkResult[]>;
type ListDockerVolumes = () => Promise<DockerListVolumeResult[]>;
type RemoveDockerNetwork = (input: DockerRemoveNetworkInput) => Promise<void>;
type SyncCurrentRuntimeNetworkEgressDenyRules = (
  config: { dockerNamespace: string },
  additionalNetworkNames: Iterable<string>,
  options?: { platformSourceContainerRefs?: readonly string[] | undefined },
) => Promise<void>;
type SyncDesiredRuntimeNetworkEgressDenyRules = (
  config: { dockerNamespace: string },
  desiredNetworkNames: { resourceNetworkNames: Set<string>; serviceNetworkNames: Set<string> },
  additionalNetworkNames?: Iterable<string>,
  options?: { platformSourceContainerRefs?: readonly string[] | undefined },
) => Promise<void>;

interface RuntimeNetworkServiceMocks {
  connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
  disconnectDockerContainerFromNetwork: Mock<DisconnectDockerContainerFromNetwork>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  execFile: Mock<ExecFile>;
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  listDockerContainers: Mock<ListDockerContainers>;
  listDockerNetworks: Mock<ListDockerNetworks>;
  listDockerVolumes: Mock<ListDockerVolumes>;
  removeDockerNetwork: Mock<RemoveDockerNetwork>;
  syncCurrentRuntimeNetworkEgressDenyRules: Mock<SyncCurrentRuntimeNetworkEgressDenyRules>;
  syncDesiredRuntimeNetworkEgressDenyRules: Mock<SyncDesiredRuntimeNetworkEgressDenyRules>;
}

interface RuntimeNetworkServiceConfigFixture {
  dockerNamespace: string;
  runtimeConnectivityMode: 'network';
  runtimeNetworkPool: RuntimeNetworkPoolConfig;
}

const mocks: RuntimeNetworkServiceMocks = vi.hoisted(
  (): RuntimeNetworkServiceMocks => ({
    connectDockerContainerToNetwork: vi.fn<ConnectDockerContainerToNetwork>(),
    disconnectDockerContainerFromNetwork: vi.fn<DisconnectDockerContainerFromNetwork>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    execFile: vi.fn<ExecFile>(),
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    listDockerContainers: vi.fn<ListDockerContainers>(),
    listDockerNetworks: vi.fn<ListDockerNetworks>(),
    listDockerVolumes: vi.fn<ListDockerVolumes>(),
    removeDockerNetwork: vi.fn<RemoveDockerNetwork>(),
    syncCurrentRuntimeNetworkEgressDenyRules: vi.fn<SyncCurrentRuntimeNetworkEgressDenyRules>(),
    syncDesiredRuntimeNetworkEgressDenyRules: vi.fn<SyncDesiredRuntimeNetworkEgressDenyRules>(),
  }),
);

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

vi.mock('node:child_process', (): { execFile: Mock<ExecFile> } => ({
  execFile: mocks.execFile,
}));

vi.mock(
  '@compartment/docker',
  (): {
    compartmentDockerNamespaceLabelName: string;
    buildDockerNamespaceLabels: (namespace: string) => Record<string, string>;
    connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
    disconnectDockerContainerFromNetwork: Mock<DisconnectDockerContainerFromNetwork>;
    ensureDockerNetwork: Mock<EnsureDockerNetwork>;
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
    listDockerContainers: Mock<ListDockerContainers>;
    listDockerNetworks: Mock<ListDockerNetworks>;
    listDockerVolumes: Mock<ListDockerVolumes>;
    removeDockerNetwork: Mock<RemoveDockerNetwork>;
  } => ({
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    buildDockerNamespaceLabels: (namespace: string): Record<string, string> => ({
      'compartment.namespace': namespace,
    }),
    connectDockerContainerToNetwork: mocks.connectDockerContainerToNetwork,
    disconnectDockerContainerFromNetwork: mocks.disconnectDockerContainerFromNetwork,
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
    listDockerContainers: mocks.listDockerContainers,
    listDockerNetworks: mocks.listDockerNetworks,
    listDockerVolumes: mocks.listDockerVolumes,
    removeDockerNetwork: mocks.removeDockerNetwork,
  }),
);

vi.mock(
  '../src/services/runtime-network-egress.service',
  (): {
    syncCurrentRuntimeNetworkEgressDenyRules: Mock<SyncCurrentRuntimeNetworkEgressDenyRules>;
    syncDesiredRuntimeNetworkEgressDenyRules: Mock<SyncDesiredRuntimeNetworkEgressDenyRules>;
  } => ({
    syncCurrentRuntimeNetworkEgressDenyRules: mocks.syncCurrentRuntimeNetworkEgressDenyRules,
    syncDesiredRuntimeNetworkEgressDenyRules: mocks.syncDesiredRuntimeNetworkEgressDenyRules,
  }),
);

beforeEach((): void => {
  mocks.execFile.mockImplementation((_file: string, _args: string[], callback: ExecFileCallback): void => {
    callback(null, '', '');
  });
  mocks.inspectDockerNetwork.mockResolvedValue(null);
  mocks.listDockerNetworks.mockResolvedValue([]);
  mocks.listDockerVolumes.mockResolvedValue([]);
});

afterEach((): void => {
  mocks.connectDockerContainerToNetwork.mockReset();
  mocks.disconnectDockerContainerFromNetwork.mockReset();
  mocks.ensureDockerNetwork.mockReset();
  mocks.execFile.mockReset();
  mocks.inspectDockerContainer.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.listDockerContainers.mockReset();
  mocks.listDockerNetworks.mockReset();
  mocks.listDockerVolumes.mockReset();
  mocks.removeDockerNetwork.mockReset();
  mocks.syncCurrentRuntimeNetworkEgressDenyRules.mockReset();
  mocks.syncDesiredRuntimeNetworkEgressDenyRules.mockReset();
});

describe('ensureRuntimeNetworkForDeployment', (): void => {
  it('detaches Caddy when post-attach network capacity validation fails', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const request: NodeDeployRequest = createDeployRequest({
      environmentId: 'env_123',
      projectId: 'prj_123',
      serviceId: 'svc_123',
    });
    const networkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValue(
      createManagedNetwork(networkName, dockerNamespace, {
        endpointContainerIds: Array.from(
          { length: 12 },
          (_value: undefined, index: number): string => `endpoint_${index}`,
        ),
      }),
    );
    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        return await Promise.resolve([]);
      },
    );

    await expect(
      ensureRuntimeNetworkForDeployment(createRuntimeNetworkConfig(dockerNamespace), request),
    ).rejects.toThrow('starting deployment container');

    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      containerRef: 'caddy_container',
      networkName,
    });
    expect(mocks.disconnectDockerContainerFromNetwork).toHaveBeenCalledWith({
      containerRef: 'caddy_container',
      networkName,
    });
  });
});

describe('reconcileRuntimeNetworks', (): void => {
  it('derives service runtime networks from runtime labels instead of existing runtime attachments', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const unrelatedNetworkName: string = 'monitoring-shared-network';
    const desiredRuntimeNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
        serviceId: 'svc_123',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readListedContainers(input, dockerNamespace)),
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName, unrelatedNetworkName],
            runtime_container: [systemNetworkName, unrelatedNetworkName],
          }),
        ),
    );
    mocks.inspectDockerNetwork.mockResolvedValueOnce(createManagedNetwork(desiredRuntimeNetworkName, dockerNamespace));

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledTimes(1);
    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      containerRef: 'caddy_container',
      networkName: desiredRuntimeNetworkName,
    });
    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
    expect(mocks.syncDesiredRuntimeNetworkEgressDenyRules).toHaveBeenCalledWith(
      expect.objectContaining({ dockerNamespace }),
      expect.objectContaining({
        serviceNetworkNames: new Set<string>([desiredRuntimeNetworkName]),
      }),
      [],
      { platformSourceContainerRefs: ['caddy_container'] },
    );
  });

  it('does not derive service runtime networks from running release containers', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const releaseResourceNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readReleaseListedContainers(input, dockerNamespace)),
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName],
            release_container: [releaseResourceNetworkName],
          }),
        ),
    );

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('keeps resource runtime networks out of caddy', async (): Promise<void> => {
    const dockerNamespace: string = 'runtime-namespace-with-enough-characters-to-force-prefix-hashing';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const resourceNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
      },
      dockerNamespace,
    );
    expect(resourceNetworkName).toHaveLength(63);

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readResourceListedContainers(input, dockerNamespace)),
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName, resourceNetworkName],
            resource_container: [resourceNetworkName],
          }),
        ),
    );
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: ['resource_container'],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
        'compartment.network.ipam': 'managed',
      },
      name: resourceNetworkName,
    });

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
    expect(mocks.disconnectDockerContainerFromNetwork).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectDockerContainerFromNetwork).toHaveBeenCalledWith({
      containerRef: 'caddy_container',
      networkName: resourceNetworkName,
    });
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('ignores resource containers missing canonical runtime labels', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        if (input.labelFilters?.['compartment.namespace'] === dockerNamespace) {
          return await Promise.resolve([
            createListedContainer('resource_container', {
              'compartment.namespace': dockerNamespace,
              'compartment.resource': 'postgres',
            }),
          ]);
        }
        return await Promise.resolve([]);
      },
    );
    mocks.inspectDockerContainer.mockResolvedValueOnce(
      createInspectedContainer('caddy_container', [systemNetworkName]),
    );

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('fails closed when a managed runtime container is missing canonical runtime labels', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readContainerWithOldRuntimeLabels(input, dockerNamespace)),
    );

    await expect(reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace))).rejects.toThrow(
      'Runtime container runtime_container is missing required runtime labels: compartment.projectId, compartment.environmentId, compartment.serviceId.',
    );

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
    expect(mocks.inspectDockerContainer).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('fails closed on desired runtime attachments without managed labels', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const desiredRuntimeNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
        serviceId: 'svc_123',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readListedContainers(input, dockerNamespace)),
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName, desiredRuntimeNetworkName],
          }),
        ),
    );
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: ['caddy_container'],
      ipamConfigs: [],
      labels: {},
      name: desiredRuntimeNetworkName,
    });

    await expect(reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace))).rejects.toThrow(
      `Docker runtime network ${desiredRuntimeNetworkName} exists without required managed Compartment network labels.`,
    );

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
  });

  it('does not connect caddy to desired runtime networks without managed labels', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const desiredRuntimeNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
        serviceId: 'svc_123',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readListedContainers(input, dockerNamespace)),
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName],
            runtime_container: [systemNetworkName, desiredRuntimeNetworkName],
          }),
        ),
    );
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: ['runtime_container'],
      ipamConfigs: [],
      labels: {},
      name: desiredRuntimeNetworkName,
    });

    await expect(reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace))).rejects.toThrow(
      `Docker runtime network ${desiredRuntimeNetworkName} exists without required managed Compartment network labels.`,
    );

    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
  });

  it('rejects desired runtime attachments with a conflicting namespace ownership label', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const desiredRuntimeNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
        serviceId: 'svc_123',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readListedContainers(input, dockerNamespace)),
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName, desiredRuntimeNetworkName],
          }),
        ),
    );
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: ['caddy_container'],
      ipamConfigs: [],
      labels: {
        'compartment.namespace': 'other',
      },
      name: desiredRuntimeNetworkName,
    });

    await expect(reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace))).rejects.toThrow(
      `Docker runtime network ${desiredRuntimeNetworkName} exists without required managed Compartment network labels.`,
    );

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
  });

  it('validates missing desired service runtime networks before connecting caddy', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const desiredRuntimeNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_123',
        projectId: 'prj_123',
        serviceId: 'svc_123',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> =>
        await Promise.resolve(readListedContainers(input, dockerNamespace)),
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName],
            runtime_container: [systemNetworkName, desiredRuntimeNetworkName],
          }),
        ),
    );
    await expect(reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace))).rejects.toThrow(
      `Docker runtime network ${desiredRuntimeNetworkName} is missing.`,
    );

    expect(mocks.connectDockerContainerToNetwork).not.toHaveBeenCalled();
  });

  it('can leave stale caddy runtime attachments in place', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const staleRuntimeNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
        serviceId: 'svc_old',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        return await Promise.resolve([]);
      },
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName, staleRuntimeNetworkName],
          }),
        ),
    );
    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace), {
      disconnectCaddyStaleNetworks: false,
    });

    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('does not treat unmanaged stale runtime networks as owned', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const staleRuntimeNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
        serviceId: 'svc_old',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        return await Promise.resolve([]);
      },
    );
    mocks.inspectDockerContainer.mockImplementation(
      async ({ containerRef }: DockerInspectContainerInput): Promise<DockerInspectContainerResult | null> =>
        await Promise.resolve(
          readInspectedContainerFromMap(containerRef, {
            caddy_container: [systemNetworkName, staleRuntimeNetworkName],
          }),
        ),
    );
    mocks.inspectDockerNetwork
      .mockResolvedValueOnce({
        endpointContainerIds: ['caddy_container'],
        ipamConfigs: [],
        labels: {
          'compartment.namespace': dockerNamespace,
        },
        name: staleRuntimeNetworkName,
      })
      .mockResolvedValueOnce({
        endpointContainerIds: [],
        ipamConfigs: [],
        labels: {
          'compartment.namespace': dockerNamespace,
        },
        name: staleRuntimeNetworkName,
      });
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        labels: {
          'compartment.namespace': dockerNamespace,
        },
        name: staleRuntimeNetworkName,
      },
    ]);

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.disconnectDockerContainerFromNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('removes stale empty managed resource runtime networks that caddy never joins', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const staleResourceNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        return await Promise.resolve([]);
      },
    );
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        labels: {
          'compartment.namespace': dockerNamespace,
          'compartment.network.ipam': 'managed',
        },
        name: staleResourceNetworkName,
      },
    ]);
    mocks.inspectDockerContainer.mockResolvedValueOnce(createInspectedContainer('caddy_container', []));
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: [],
      ipamConfigs: [],
      labels: {
        'compartment.namespace': dockerNamespace,
        'compartment.network.ipam': 'managed',
      },
      name: staleResourceNetworkName,
    });
    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({
      networkName: staleResourceNetworkName,
    });
  });

  it('keeps active endpoint reservations on existing empty runtime networks without reservation labels', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const staleResourceNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        return await Promise.resolve([]);
      },
    );
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        labels: {
          'compartment.namespace': dockerNamespace,
          'compartment.network.ipam': 'managed',
        },
        name: staleResourceNetworkName,
      },
    ]);
    mocks.inspectDockerContainer.mockResolvedValueOnce(createInspectedContainer('caddy_container', []));
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: [],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
        'compartment.network.ipam': 'managed',
      },
      name: staleResourceNetworkName,
    });
    mocks.listDockerVolumes.mockResolvedValueOnce([
      createEndpointReservationVolume({
        dockerNamespace,
        networkName: staleResourceNetworkName,
        reservationId: 'dep_reserved',
      }),
    ]);

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('removes empty reservation-labeled networks without active endpoint reservations', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const staleResourceNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        return await Promise.resolve([]);
      },
    );
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        labels: {
          'compartment.namespace': dockerNamespace,
          'compartment.network.ipam': 'managed',
        },
        name: staleResourceNetworkName,
      },
    ]);
    mocks.inspectDockerContainer.mockResolvedValueOnce(createInspectedContainer('caddy_container', []));
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: [],
      ipamConfigs: [
        {
          gateway: null,
          subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28),
        },
      ],
      labels: {
        'compartment.namespace': dockerNamespace,
        'compartment.network.ipam': 'managed',
        'compartment.network.reservationExpiresAt': '2999-01-01T00:00:00.000Z',
        'compartment.network.reservationId': 'dep_reserved',
      },
      name: staleResourceNetworkName,
    });

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: staleResourceNetworkName });
  });

  it('ignores same-prefix runtime networks without the compartment namespace label', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const staleResourceNetworkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
      },
      dockerNamespace,
    );

    mocks.listDockerContainers.mockImplementation(
      async (input: DockerListContainersInput): Promise<DockerListContainerResult[]> => {
        if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
          return await Promise.resolve([createListedContainer('caddy_container', {})]);
        }
        return await Promise.resolve([]);
      },
    );
    mocks.inspectDockerContainer.mockResolvedValueOnce(createInspectedContainer('caddy_container', []));
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        labels: {},
        name: staleResourceNetworkName,
      },
    ]);

    await reconcileRuntimeNetworks(createRuntimeNetworkConfig(dockerNamespace));

    expect(mocks.inspectDockerNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });
});

function createListedContainer(containerId: string, labels: Record<string, string>): DockerListContainerResult {
  return {
    containerId,
    isRunning: true,
    labels,
  };
}

function createInspectedContainer(containerId: string, networkNames: readonly string[]): DockerInspectContainerResult {
  return {
    containerId,
    imageRef: 'sha256:image',
    isRunning: true,
    labels: {},
    networkAttachments: networkNames.map((name: string): { ipAddress: string | null; name: string } => ({
      ipAddress: null,
      name,
    })),
    publishedPorts: [],
  };
}

function createManagedNetwork(
  networkName: string,
  dockerNamespace: string,
  overrides: Partial<DockerInspectNetworkResult> = {},
): DockerInspectNetworkResult {
  return {
    endpointContainerIds: [],
    ipamConfigs: [
      {
        gateway: null,
        subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28),
      },
    ],
    labels: {
      'compartment.environmentId': 'env_123',
      'compartment.namespace': dockerNamespace,
      'compartment.network.ipam': 'managed',
      'compartment.network.kind': 'service',
      'compartment.network.poolCidr': createRuntimeNetworkPoolConfig().cidr,
      'compartment.network.subnet': buildTestIpv4Cidr(10, 240, 0, 0, 28),
      'compartment.network.subnetPrefix': createRuntimeNetworkPoolConfig().subnetPrefixLength.toString(),
      'compartment.projectId': 'prj_123',
      'compartment.serviceId': 'svc_123',
    },
    name: networkName,
    ...overrides,
  };
}

function createEndpointReservationVolume(input: {
  dockerNamespace: string;
  networkName: string;
  reservationId: string;
}): DockerListVolumeResult {
  return {
    labels: {
      'compartment.namespace': input.dockerNamespace,
      'compartment.network.endpointReservation': 'true',
      'compartment.network.endpointReservation.expiresAt': '2999-01-01T00:00:00.000Z',
      'compartment.network.endpointReservation.id': input.reservationId,
      'compartment.network.endpointReservation.network': input.networkName,
    },
    name: `volume_${input.reservationId}`,
  };
}

function createRuntimeNetworkConfig(dockerNamespace: string): RuntimeNetworkServiceConfigFixture {
  return {
    dockerNamespace,
    runtimeConnectivityMode: 'network',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
  };
}

function readListedContainers(input: DockerListContainersInput, dockerNamespace: string): DockerListContainerResult[] {
  if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
    return [createListedContainer('caddy_container', {})];
  }
  if (input.labelFilters?.['compartment.namespace'] === dockerNamespace) {
    return [
      createListedContainer('runtime_container', {
        'compartment.namespace': dockerNamespace,
        'compartment.deploymentId': 'dep_123',
        'compartment.environmentId': 'env_123',
        'compartment.projectId': 'prj_123',
        'compartment.serviceId': 'svc_123',
      }),
    ];
  }

  return [];
}

function readResourceListedContainers(
  input: DockerListContainersInput,
  dockerNamespace: string,
): DockerListContainerResult[] {
  if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
    return [createListedContainer('caddy_container', {})];
  }
  if (input.labelFilters?.['compartment.namespace'] === dockerNamespace) {
    return [
      createListedContainer('resource_container', {
        'compartment.namespace': dockerNamespace,
        'compartment.environmentId': 'env_123',
        'compartment.projectId': 'prj_123',
        'compartment.resource': 'postgres',
      }),
    ];
  }

  return [];
}

function readReleaseListedContainers(
  input: DockerListContainersInput,
  dockerNamespace: string,
): DockerListContainerResult[] {
  if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
    return [createListedContainer('caddy_container', {})];
  }
  if (input.labelFilters?.['compartment.namespace'] === dockerNamespace) {
    return [
      createListedContainer('release_container', {
        'compartment.namespace': dockerNamespace,
        'compartment.deploymentId': 'dep_123',
        'compartment.environmentId': 'env_123',
        'compartment.projectId': 'prj_123',
        'compartment.release': 'true',
        'compartment.serviceId': 'svc_123',
      }),
    ];
  }

  return [];
}

function readContainerWithOldRuntimeLabels(
  input: DockerListContainersInput,
  dockerNamespace: string,
): DockerListContainerResult[] {
  if (input.labelFilters?.['com.docker.compose.service'] === 'caddy') {
    return [createListedContainer('caddy_container', {})];
  }
  if (input.labelFilters?.['compartment.namespace'] === dockerNamespace) {
    return [
      createListedContainer('runtime_container', {
        'compartment.namespace': dockerNamespace,
        'compartment.deploymentId': 'dep_old',
        'compartment.environment': 'production',
        'compartment.project': 'smoke-web',
        'compartment.service': 'web',
      }),
    ];
  }

  return [];
}

function readInspectedContainerFromMap(
  containerRef: string,
  networkNamesByContainer: Record<string, readonly string[]>,
): DockerInspectContainerResult | null {
  const networkNames: readonly string[] | undefined = networkNamesByContainer[containerRef];
  if (networkNames === undefined) {
    return null;
  }

  return createInspectedContainer(containerRef, networkNames);
}
