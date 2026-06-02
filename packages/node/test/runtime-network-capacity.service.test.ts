import type {
  DockerInspectNetworkResult,
  DockerListContainerResult,
  DockerListNetworkResult,
  DockerListVolumeResult,
  DockerNetworkIpamConfig,
} from '@compartment/docker';
import type {
  NodeRuntimeNetworkReservationRequest,
  NodeRuntimeNetworkReservationResponse,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { isNodeRuntimeError } from '../src/errors/node-runtime-error';
import {
  cleanupRuntimeNetworkReservation,
  reserveRuntimeNetworksForDeployment,
} from '../src/services/runtime-network-capacity.service';
import {
  formatIpv4Cidr,
  parseIpv4Cidr,
  parseIpv4RouteCidrs,
  type Ipv4Cidr,
} from '../src/services/runtime-network-cidr.service';
import { assertRuntimeNetworkSubnetEndpointCapacity } from '../src/services/runtime-network-endpoint-capacity.service';
import { allocateRuntimeNetworkSubnets } from '../src/services/runtime-network-subnet-allocation.service';
import { buildRuntimeResourceNetworkName, buildRuntimeServiceNetworkName } from '../src/services/runtime-names.service';
import type { RuntimeConnectivityMode, RuntimeNetworkPoolConfig } from '../src/services/runtime.types';
import {
  buildTestIpv4Address,
  buildTestIpv4Cidr,
  createRuntimeNetworkPoolConfig,
} from './runtime-network-pool.fixture';

interface DockerEnsureNetworkInput {
  ipam?: { subnet: string } | undefined;
  labels: Record<string, string>;
  networkName: string;
}

interface DockerEnsureVolumeInput {
  labels: Record<string, string>;
  volumeName: string;
}

interface DockerListVolumesInput {
  labelFilters?: Record<string, string | undefined> | undefined;
}

interface DockerConnectContainerToNetworkInput {
  aliases?: string[] | undefined;
  containerRef: string;
  networkName: string;
}

interface DockerDisconnectContainerFromNetworkInput {
  containerRef: string;
  networkName: string;
}

interface DockerInspectContainerResultFixture {
  containerId: string;
  imageRef: string;
  isRunning: boolean;
  labels: Record<string, string>;
  publishedPorts: [];
}

interface RuntimeNetworkCapacityConfig {
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
  runtimeNetworkPool: RuntimeNetworkPoolConfig;
}

type EnsureDockerNetwork = (input: DockerEnsureNetworkInput) => Promise<void>;
type EnsureDockerVolume = (input: DockerEnsureVolumeInput) => Promise<void>;
type ConnectDockerContainerToNetwork = (input: DockerConnectContainerToNetworkInput) => Promise<void>;
type DisconnectDockerContainerFromNetwork = (input: DockerDisconnectContainerFromNetworkInput) => Promise<void>;
type ExecFile = (file: string, args: string[], callback: ExecFileCallback) => void;
type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResultFixture | null>;
type InspectDockerNetwork = (input: { networkName: string }) => Promise<DockerInspectNetworkResult | null>;
type IsDockerNetworkIpamCapacityError = (error: Error) => boolean;
type ListDockerContainers = () => Promise<DockerListContainerResult[]>;
type ListDockerNetworks = () => Promise<DockerListNetworkResult[]>;
type ListDockerVolumes = (input?: DockerListVolumesInput) => Promise<DockerListVolumeResult[]>;
type ReadDockerEngineErrorMessage = (error: Error) => string;
type RemoveDockerNetwork = (input: { networkName: string }) => Promise<void>;
type RemoveDockerVolume = (input: { volumeName: string }) => Promise<void>;

const runtimeNetworkKindLabelName: string = 'compartment.network.kind';
const runtimeNetworkManagedIpamLabelName: string = 'compartment.network.ipam';
const runtimeNetworkPoolCidrLabelName: string = 'compartment.network.poolCidr';
const runtimeNetworkReservationExpiresAtLabelName: string = 'compartment.network.reservationExpiresAt';
const runtimeNetworkReservationIdLabelName: string = 'compartment.network.reservationId';
const runtimeNetworkSubnetLabelName: string = 'compartment.network.subnet';
const runtimeNetworkSubnetPrefixLabelName: string = 'compartment.network.subnetPrefix';

interface RuntimeNetworkCapacityMocks {
  connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
  disconnectDockerContainerFromNetwork: Mock<DisconnectDockerContainerFromNetwork>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  ensureDockerVolume: Mock<EnsureDockerVolume>;
  execFile: Mock<ExecFile>;
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  isDockerNetworkIpamCapacityError: Mock<IsDockerNetworkIpamCapacityError>;
  listDockerContainers: Mock<ListDockerContainers>;
  listDockerNetworks: Mock<ListDockerNetworks>;
  listDockerVolumes: Mock<ListDockerVolumes>;
  readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
  removeDockerNetwork: Mock<RemoveDockerNetwork>;
  removeDockerVolume: Mock<RemoveDockerVolume>;
}

const mocks: RuntimeNetworkCapacityMocks = vi.hoisted(
  (): RuntimeNetworkCapacityMocks => ({
    connectDockerContainerToNetwork: vi.fn<ConnectDockerContainerToNetwork>(),
    disconnectDockerContainerFromNetwork: vi.fn<DisconnectDockerContainerFromNetwork>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    ensureDockerVolume: vi.fn<EnsureDockerVolume>(),
    execFile: vi.fn<ExecFile>(),
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    isDockerNetworkIpamCapacityError: vi.fn<IsDockerNetworkIpamCapacityError>(),
    listDockerContainers: vi.fn<ListDockerContainers>(),
    listDockerNetworks: vi.fn<ListDockerNetworks>(),
    listDockerVolumes: vi.fn<ListDockerVolumes>(),
    readDockerEngineErrorMessage: vi.fn<ReadDockerEngineErrorMessage>(),
    removeDockerNetwork: vi.fn<RemoveDockerNetwork>(),
    removeDockerVolume: vi.fn<RemoveDockerVolume>(),
  }),
);

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
    ensureDockerVolume: Mock<EnsureDockerVolume>;
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
    isDockerNetworkIpamCapacityError: Mock<IsDockerNetworkIpamCapacityError>;
    listDockerContainers: Mock<ListDockerContainers>;
    listDockerNetworks: Mock<ListDockerNetworks>;
    listDockerVolumes: Mock<ListDockerVolumes>;
    readDockerEngineErrorMessage: Mock<ReadDockerEngineErrorMessage>;
    removeDockerNetwork: Mock<RemoveDockerNetwork>;
    removeDockerVolume: Mock<RemoveDockerVolume>;
  } => ({
    buildDockerNamespaceLabels: (namespace: string): Record<string, string> => ({
      'compartment.namespace': namespace,
    }),
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    connectDockerContainerToNetwork: mocks.connectDockerContainerToNetwork,
    disconnectDockerContainerFromNetwork: mocks.disconnectDockerContainerFromNetwork,
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    ensureDockerVolume: mocks.ensureDockerVolume,
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
    isDockerNetworkIpamCapacityError: mocks.isDockerNetworkIpamCapacityError,
    listDockerContainers: mocks.listDockerContainers,
    listDockerNetworks: mocks.listDockerNetworks,
    listDockerVolumes: mocks.listDockerVolumes,
    readDockerEngineErrorMessage: mocks.readDockerEngineErrorMessage,
    removeDockerNetwork: mocks.removeDockerNetwork,
    removeDockerVolume: mocks.removeDockerVolume,
  }),
);

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

const dockerNamespace: string = 'test';

beforeEach((): void => {
  const networks: Map<string, DockerInspectNetworkResult> = new Map<string, DockerInspectNetworkResult>();
  const volumes: Map<string, DockerListVolumeResult> = new Map<string, DockerListVolumeResult>();
  mocks.execFile.mockImplementation((_file: string, _args: string[], callback: ExecFileCallback): void => {
    callback(null, '', '');
  });
  mocks.listDockerContainers.mockResolvedValue([]);
  mocks.inspectDockerNetwork.mockImplementation(
    async ({ networkName }: { networkName: string }): Promise<DockerInspectNetworkResult | null> => {
      await Promise.resolve();
      return networks.get(networkName) ?? null;
    },
  );
  mocks.listDockerNetworks.mockImplementation(async (): Promise<DockerListNetworkResult[]> => {
    await Promise.resolve();
    return [...networks.values()].map(toListedNetwork);
  });
  mocks.listDockerVolumes.mockImplementation(async (): Promise<DockerListVolumeResult[]> => {
    await Promise.resolve();
    return [...volumes.values()];
  });
  mocks.ensureDockerNetwork.mockImplementation(async (input: DockerEnsureNetworkInput): Promise<void> => {
    await Promise.resolve();
    networks.set(input.networkName, {
      endpointContainerIds: [],
      ipamConfigs: [createIpamConfig(input.ipam?.subnet ?? buildTestIpv4Cidr(10, 240, 255, 0, 28))],
      labels: input.labels,
      name: input.networkName,
    });
  });
  mocks.ensureDockerVolume.mockImplementation(async (input: DockerEnsureVolumeInput): Promise<void> => {
    await Promise.resolve();
    volumes.set(input.volumeName, {
      labels: input.labels,
      name: input.volumeName,
    });
  });
  mocks.connectDockerContainerToNetwork.mockResolvedValue(undefined);
  mocks.disconnectDockerContainerFromNetwork.mockResolvedValue(undefined);
  mocks.inspectDockerContainer.mockResolvedValue(null);
  mocks.removeDockerVolume.mockImplementation(async ({ volumeName }: { volumeName: string }): Promise<void> => {
    await Promise.resolve();
    volumes.delete(volumeName);
  });
  mocks.isDockerNetworkIpamCapacityError.mockReturnValue(false);
  mocks.readDockerEngineErrorMessage.mockImplementation((error: Error): string => error.message);
});

afterEach((): void => {
  mocks.connectDockerContainerToNetwork.mockReset();
  mocks.disconnectDockerContainerFromNetwork.mockReset();
  mocks.ensureDockerNetwork.mockReset();
  mocks.ensureDockerVolume.mockReset();
  mocks.execFile.mockReset();
  mocks.inspectDockerContainer.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.isDockerNetworkIpamCapacityError.mockReset();
  mocks.listDockerContainers.mockReset();
  mocks.listDockerNetworks.mockReset();
  mocks.listDockerVolumes.mockReset();
  mocks.readDockerEngineErrorMessage.mockReset();
  mocks.removeDockerNetwork.mockReset();
  mocks.removeDockerVolume.mockReset();
});

describe('reserveRuntimeNetworksForDeployment', (): void => {
  it('calculates usable runtime network container IP capacity from subnet size', (): void => {
    expect((): void => {
      assertRuntimeNetworkSubnetEndpointCapacity({
        networkName: 'test-network',
        reason: 'test',
        requiredEndpoints: 5,
        subnet: parseIpv4Cidr(buildTestIpv4Cidr(10, 240, 0, 0, 29)),
      });
    }).not.toThrow();
    expect((): void => {
      assertRuntimeNetworkSubnetEndpointCapacity({
        networkName: 'test-network',
        reason: 'test',
        requiredEndpoints: 14,
        subnet: parseIpv4Cidr(buildTestIpv4Cidr(10, 240, 0, 0, 28)),
      });
    }).toThrow('with 13 usable container IPs');
    expect((): void => {
      assertRuntimeNetworkSubnetEndpointCapacity({
        networkName: 'test-network',
        reason: 'test',
        requiredEndpoints: 2,
        subnet: parseIpv4Cidr(buildTestIpv4Cidr(10, 240, 0, 0, 30)),
      });
    }).toThrow('with 1 usable container IPs');
  });

  it('creates only the service network for a plain network-mode app', async (): Promise<void> => {
    const response: NodeRuntimeNetworkReservationResponse = await reserveRuntimeNetworksForDeployment(
      createReservationRequest(),
      createConfig(),
    );
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(createReservationRequest(), dockerNamespace);
    const createInput: DockerEnsureNetworkInput = expectPresent(mocks.ensureDockerNetwork.mock.calls[0]?.[0]);

    expect(response.reservedNetworkNames).toEqual([serviceNetworkName]);
    expect(response.newlyCreatedNetworkNames).toEqual([serviceNetworkName]);
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledTimes(1);
    expect(mocks.ensureDockerVolume).toHaveBeenCalledTimes(2);
    expect(createInput).toMatchObject({
      ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
      networkName: serviceNetworkName,
    });
    expect(createInput.labels).toMatchObject({
      'compartment.namespace': dockerNamespace,
      [runtimeNetworkKindLabelName]: 'service',
      [runtimeNetworkManagedIpamLabelName]: 'managed',
      [runtimeNetworkReservationIdLabelName]: 'dep_123',
      [runtimeNetworkSubnetLabelName]: buildTestIpv4Cidr(10, 240, 0, 0, 28),
    });
  });

  it('creates one shared resource network when resource outputs are required', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest({
      requiresResourceNetwork: true,
    });
    const response: NodeRuntimeNetworkReservationResponse = await reserveRuntimeNetworksForDeployment(
      request,
      createConfig(),
    );
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    const resourceNetworkName: string = buildRuntimeResourceNetworkName(request, dockerNamespace);
    const resourceCreateInput: DockerEnsureNetworkInput = expectPresent(mocks.ensureDockerNetwork.mock.calls[1]?.[0]);

    expect(response.reservedNetworkNames).toEqual([serviceNetworkName, resourceNetworkName]);
    expect(mocks.ensureDockerVolume).toHaveBeenCalledTimes(3);
    expect(resourceCreateInput).toMatchObject({
      ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 16, 28) },
      networkName: resourceNetworkName,
    });
    expect(resourceCreateInput.labels).toMatchObject({
      [runtimeNetworkKindLabelName]: 'resource',
      [runtimeNetworkSubnetLabelName]: buildTestIpv4Cidr(10, 240, 0, 16, 28),
    });
  });

  it('retries Docker IPAM create conflicts with a different managed subnet', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const ipamConflict: Error = new Error('Pool overlaps with another one on this address space');
    mocks.isDockerNetworkIpamCapacityError.mockImplementation((error: Error): boolean => error === ipamConflict);
    mocks.ensureDockerNetwork.mockRejectedValueOnce(ipamConflict).mockResolvedValueOnce(undefined);

    const response: NodeRuntimeNetworkReservationResponse = await reserveRuntimeNetworksForDeployment(
      request,
      createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 27) }),
    );

    expect(response.newlyCreatedNetworkNames).toEqual([buildRuntimeServiceNetworkName(request, dockerNamespace)]);
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledTimes(2);
    expect(
      mocks.ensureDockerNetwork.mock.calls.map(
        (call: [DockerEnsureNetworkInput]): string | undefined => call[0].ipam?.subnet,
      ),
    ).toEqual([buildTestIpv4Cidr(10, 240, 0, 0, 28), buildTestIpv4Cidr(10, 240, 0, 16, 28)]);
  });

  it('serializes concurrent reservations so each service gets a distinct subnet', async (): Promise<void> => {
    const firstRequest: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const secondRequest: NodeRuntimeNetworkReservationRequest = createReservationRequest({
      deploymentId: 'dep_456',
      serviceId: 'svc_456',
    });

    await Promise.all([
      reserveRuntimeNetworksForDeployment(firstRequest, createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 27) })),
      reserveRuntimeNetworksForDeployment(secondRequest, createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 27) })),
    ]);

    expect(mocks.ensureDockerNetwork).toHaveBeenCalledTimes(2);
    const createdSubnets: (string | undefined)[] = mocks.ensureDockerNetwork.mock.calls.map(
      (call: [DockerEnsureNetworkInput]): string | undefined => call[0].ipam?.subnet,
    );
    expect(createdSubnets).toEqual([buildTestIpv4Cidr(10, 240, 0, 0, 28), buildTestIpv4Cidr(10, 240, 0, 16, 28)]);
  });

  it('fails before Docker create when the pool cannot reserve all required networks', async (): Promise<void> => {
    await expect(
      reserveRuntimeNetworksForDeployment(
        createReservationRequest({ requiresResourceNetwork: true }),
        createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 28) }),
      ),
    ).rejects.toMatchObject({
      code: 'runtime_network_capacity_exhausted',
    });

    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
    expect(mocks.removeDockerNetwork).not.toHaveBeenCalled();
  });

  it('rejects invalid subnet allocation counts before reading Docker state', async (): Promise<void> => {
    await expect(allocateRuntimeNetworkSubnets(createConfig().runtimeNetworkPool, -1)).rejects.toThrow(
      'non-negative integer',
    );

    expect(mocks.listDockerNetworks).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('fails before Docker create when a new service network subnet cannot fit caddy and the app endpoint', async (): Promise<void> => {
    let failure: Error | undefined;
    try {
      await reserveRuntimeNetworksForDeployment(
        createReservationRequest(),
        createConfig({
          cidr: buildTestIpv4Cidr(10, 240, 0, 0, 30),
          subnetPrefixLength: 30,
        }),
      );
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toMatchObject({ code: 'runtime_network_capacity_exhausted' });
    expect(failure?.message).toContain('needs 3 for new service runtime network');
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
  });

  it('fails before Docker create when an existing desired network has no free endpoint capacity', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValue(
      createManagedServiceNetwork(request, {
        endpointContainerIds: Array.from(
          { length: 13 },
          (_value: undefined, index: number): string => `endpoint_${index}`,
        ),
        networkName: serviceNetworkName,
        subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28),
      }),
    );

    let failure: Error | undefined;
    try {
      await reserveRuntimeNetworksForDeployment(request, createConfig());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toMatchObject({ code: 'runtime_network_capacity_exhausted' });
    expect(failure?.message).toContain('needs 2 more for deployment reservation');
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
  });

  it('counts active endpoint reservations before accepting an existing runtime network', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValue(
      createManagedServiceNetwork(request, {
        endpointContainerIds: Array.from(
          { length: 11 },
          (_value: undefined, index: number): string => `endpoint_${index}`,
        ),
        networkName: serviceNetworkName,
        subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28),
      }),
    );
    mocks.listDockerVolumes.mockResolvedValueOnce([]).mockResolvedValueOnce([
      createEndpointReservationVolume({
        networkName: serviceNetworkName,
        reservationId: 'dep_other',
      }),
    ]);

    let failure: Error | undefined;
    try {
      await reserveRuntimeNetworksForDeployment(request, createConfig());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toMatchObject({ code: 'runtime_network_capacity_exhausted' });
    expect(failure?.message).toContain('11 attached endpoints, and 1 reserved endpoints');
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
    expect(mocks.ensureDockerVolume).not.toHaveBeenCalled();
  });

  it('removes already-created empty networks when reservation create fails', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest({
      requiresResourceNetwork: true,
    });
    const createdNetworks: Map<string, DockerInspectNetworkResult> = new Map<string, DockerInspectNetworkResult>();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    const resourceNetworkName: string = buildRuntimeResourceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockImplementation(
      async ({ networkName }: { networkName: string }): Promise<DockerInspectNetworkResult | null> => {
        await Promise.resolve();
        return createdNetworks.get(networkName) ?? null;
      },
    );
    mocks.ensureDockerNetwork.mockImplementation(async (input: DockerEnsureNetworkInput): Promise<void> => {
      await Promise.resolve();
      if (input.networkName === resourceNetworkName) {
        throw new Error('Docker Engine rejected network creation.');
      }
      createdNetworks.set(input.networkName, createInspectedNetwork(input));
    });

    await expect(reserveRuntimeNetworksForDeployment(request, createConfig())).rejects.toMatchObject({
      code: 'runtime_docker_error',
    });

    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: serviceNetworkName });
  });

  it('migrates an existing legacy same-name runtime network during self-hosted update', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValue({
      endpointContainerIds: [],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(172, 20, 0, 0, 16))],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: serviceNetworkName,
    });

    await expect(reserveRuntimeNetworksForDeployment(request, createConfig())).resolves.toMatchObject({
      newlyCreatedNetworkNames: [serviceNetworkName],
      reservedNetworkNames: [serviceNetworkName],
    });
    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: serviceNetworkName });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
        networkName: serviceNetworkName,
      }),
    );
    expect(mocks.ensureDockerVolume).toHaveBeenCalledTimes(2);
  });

  it('replaces an empty unlabeled same-name runtime network before reservation', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValue({
      endpointContainerIds: [],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(172, 21, 0, 0, 16))],
      labels: {},
      name: serviceNetworkName,
    });

    await expect(reserveRuntimeNetworksForDeployment(request, createConfig())).resolves.toMatchObject({
      newlyCreatedNetworkNames: [serviceNetworkName],
      reservedNetworkNames: [serviceNetworkName],
    });
    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: serviceNetworkName });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
        networkName: serviceNetworkName,
      }),
    );
  });

  it('migrates active legacy runtime networks and reconnects service aliases', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValue({
      endpointContainerIds: ['container_123'],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(172, 20, 0, 0, 16))],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: serviceNetworkName,
    });
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': request.deploymentId,
        'compartment.upstreamHost': 'upstream-dep-123',
      },
      publishedPorts: [],
    });

    await reserveRuntimeNetworksForDeployment(request, createConfig());

    expect(mocks.disconnectDockerContainerFromNetwork).toHaveBeenCalledWith({
      containerRef: 'container_123',
      networkName: serviceNetworkName,
    });
    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: serviceNetworkName });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
        networkName: serviceNetworkName,
      }),
    );
    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      aliases: ['upstream-dep-123'],
      containerRef: 'container_123',
      networkName: serviceNetworkName,
    });
  });

  it('restores same-name legacy participants when legacy network removal fails', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValue({
      endpointContainerIds: ['container_123'],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(172, 20, 0, 0, 16))],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: serviceNetworkName,
    });
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': request.deploymentId,
        'compartment.upstreamHost': 'upstream-dep-123',
      },
      publishedPorts: [],
    });
    mocks.removeDockerNetwork.mockRejectedValueOnce(new Error('remove failed'));

    await expect(reserveRuntimeNetworksForDeployment(request, createConfig())).rejects.toThrow('remove failed');

    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith({
      ipam: { subnet: buildTestIpv4Cidr(172, 20, 0, 0, 16) },
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      networkName: serviceNetworkName,
    });
    expect(mocks.connectDockerContainerToNetwork).toHaveBeenCalledWith({
      aliases: ['upstream-dep-123'],
      containerRef: 'container_123',
      networkName: serviceNetworkName,
    });
  });

  it('migrates an existing legacy same-name runtime network without Docker IPAM', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: [],
      ipamConfigs: [],
      labels: {
        'compartment.namespace': dockerNamespace,
      },
      name: serviceNetworkName,
    });

    await expect(reserveRuntimeNetworksForDeployment(request, createConfig())).resolves.toMatchObject({
      newlyCreatedNetworkNames: [serviceNetworkName],
      reservedNetworkNames: [serviceNetworkName],
    });
    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: serviceNetworkName });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
        networkName: serviceNetworkName,
      }),
    );
  });

  it('fails closed when same-name managed labels do not match Docker IPAM', async (): Promise<void> => {
    const request: NodeRuntimeNetworkReservationRequest = createReservationRequest();
    const serviceNetworkName: string = buildRuntimeServiceNetworkName(request, dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: [],
      ipamConfigs: [],
      labels: {
        'compartment.environmentId': request.environmentId,
        'compartment.namespace': dockerNamespace,
        'compartment.network.ipam': 'managed',
        'compartment.projectId': request.projectId,
        'compartment.serviceId': request.serviceId,
        [runtimeNetworkKindLabelName]: 'service',
        [runtimeNetworkPoolCidrLabelName]: createRuntimeNetworkPoolConfig().cidr,
        [runtimeNetworkSubnetLabelName]: buildTestIpv4Cidr(10, 240, 0, 0, 28),
        [runtimeNetworkSubnetPrefixLabelName]: createRuntimeNetworkPoolConfig().subnetPrefixLength.toString(),
      },
      name: serviceNetworkName,
    });

    await expect(reserveRuntimeNetworksForDeployment(request, createConfig())).rejects.toThrow(
      `Docker runtime network ${serviceNetworkName} exists without required managed Docker IPAM subnet.`,
    );
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
  });

  it('returns runtime capacity exhaustion before Docker create when the configured pool is full', async (): Promise<void> => {
    mocks.listDockerNetworks.mockResolvedValue([
      {
        ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(10, 240, 0, 0, 28))],
        labels: {},
        name: 'foreign-network',
      },
    ]);

    let failure: Error | undefined;
    try {
      await reserveRuntimeNetworksForDeployment(
        createReservationRequest(),
        createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 28) }),
      );
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(isNodeRuntimeError(failure)).toBe(true);
    if (isNodeRuntimeError(failure)) {
      expect(failure.code).toBe('runtime_network_capacity_exhausted');
    }
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
  });

  it('removes expired empty reservations before capacity math', async (): Promise<void> => {
    const expiredNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
        serviceId: 'svc_old',
      },
      dockerNamespace,
    );
    const expiredNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: [],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(10, 240, 0, 0, 28))],
      labels: {
        'compartment.namespace': dockerNamespace,
        [runtimeNetworkManagedIpamLabelName]: 'managed',
        [runtimeNetworkReservationExpiresAtLabelName]: '2020-01-01T00:00:00.000Z',
        [runtimeNetworkReservationIdLabelName]: 'dep_old',
      },
      name: expiredNetworkName,
    };
    mocks.listDockerNetworks.mockResolvedValueOnce([toListedNetwork(expiredNetwork)]).mockResolvedValueOnce([]);
    mocks.inspectDockerNetwork.mockImplementation(
      async ({ networkName }: { networkName: string }): Promise<DockerInspectNetworkResult | null> =>
        await Promise.resolve(networkName === expiredNetworkName ? expiredNetwork : null),
    );

    await reserveRuntimeNetworksForDeployment(
      createReservationRequest(),
      createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 28) }),
    );

    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: expiredNetworkName });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
      }),
    );
  });

  it('removes expired endpoint reservation volumes before capacity math', async (): Promise<void> => {
    const expiredVolume: DockerListVolumeResult = createEndpointReservationVolume({
      expiresAt: '2020-01-01T00:00:00.000Z',
      networkName: buildRuntimeServiceNetworkName(createReservationRequest(), dockerNamespace),
      reservationId: 'dep_old',
    });
    mocks.listDockerVolumes.mockResolvedValueOnce([expiredVolume]);

    await reserveRuntimeNetworksForDeployment(createReservationRequest(), createConfig());

    expect(mocks.removeDockerVolume).toHaveBeenCalledWith({ volumeName: expiredVolume.name });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalled();
  });

  it('removes stale empty managed networks before capacity math', async (): Promise<void> => {
    const staleNetworkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_old',
        projectId: 'prj_old',
        serviceId: 'svc_old',
      },
      dockerNamespace,
    );
    const staleNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: [],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(10, 240, 0, 0, 28))],
      labels: {
        'compartment.namespace': dockerNamespace,
        [runtimeNetworkManagedIpamLabelName]: 'managed',
      },
      name: staleNetworkName,
    };
    mocks.listDockerNetworks
      .mockResolvedValueOnce([toListedNetwork(staleNetwork)])
      .mockResolvedValueOnce([toListedNetwork(staleNetwork)]);
    mocks.inspectDockerNetwork.mockImplementation(
      async ({ networkName }: { networkName: string }): Promise<DockerInspectNetworkResult | null> =>
        await Promise.resolve(networkName === staleNetworkName ? staleNetwork : null),
    );

    await reserveRuntimeNetworksForDeployment(
      createReservationRequest(),
      createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 28) }),
    );

    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName: staleNetworkName });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        ipam: { subnet: buildTestIpv4Cidr(10, 240, 0, 0, 28) },
      }),
    );
  });

  it('treats overlapping host routes as occupied while ignoring the default route', async (): Promise<void> => {
    mocks.execFile.mockImplementationOnce((_file: string, _args: string[], callback: ExecFileCallback): void => {
      callback(
        null,
        `default via ${buildTestIpv4Address(10, 0, 0, 1)} dev eth0
${buildTestIpv4Cidr(10, 240, 0, 0, 28)} dev br-runtime proto kernel scope link`,
        '',
      );
    });

    await expect(
      reserveRuntimeNetworksForDeployment(
        createReservationRequest(),
        createConfig({ cidr: buildTestIpv4Cidr(10, 240, 0, 0, 28) }),
      ),
    ).rejects.toMatchObject({
      code: 'runtime_network_capacity_exhausted',
    });
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
  });

  it('fails closed when host routes cannot be inspected', async (): Promise<void> => {
    mocks.execFile.mockImplementationOnce((_file: string, _args: string[], callback: ExecFileCallback): void => {
      callback(new Error('ip command failed'), '', '');
    });

    await expect(reserveRuntimeNetworksForDeployment(createReservationRequest(), createConfig())).rejects.toMatchObject(
      {
        code: 'runtime_network_capacity_exhausted',
      },
    );
    expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
  });
});

describe('cleanupRuntimeNetworkReservation', (): void => {
  it('removes endpoint reservations owned by the matching reservation', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(createReservationRequest(), dockerNamespace);
    const volume: DockerListVolumeResult = createEndpointReservationVolume({
      networkName,
      reservationId: 'dep_123',
    });
    mocks.listDockerVolumes.mockResolvedValueOnce([volume]);

    await cleanupRuntimeNetworkReservation(
      {
        networkNames: [],
        reservationId: 'dep_123',
      },
      createConfig(),
    );

    expect(mocks.removeDockerVolume).toHaveBeenCalledWith({ volumeName: volume.name });
  });

  it('removes only empty networks owned by the matching reservation', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(createReservationRequest(), dockerNamespace);
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: [],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(10, 240, 0, 0, 28))],
      labels: {
        'compartment.namespace': dockerNamespace,
        [runtimeNetworkManagedIpamLabelName]: 'managed',
        [runtimeNetworkReservationIdLabelName]: 'dep_123',
      },
      name: networkName,
    });

    await cleanupRuntimeNetworkReservation(
      {
        networkNames: [networkName],
        reservationId: 'dep_123',
      },
      createConfig(),
    );

    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName });
  });

  it('removes empty matching reservation networks by id when network names are unknown', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(createReservationRequest(), dockerNamespace);
    const reservedNetwork: DockerInspectNetworkResult = {
      endpointContainerIds: [],
      ipamConfigs: [createIpamConfig(buildTestIpv4Cidr(10, 240, 0, 0, 28))],
      labels: {
        'compartment.namespace': dockerNamespace,
        [runtimeNetworkManagedIpamLabelName]: 'managed',
        [runtimeNetworkReservationIdLabelName]: 'dep_123',
      },
      name: networkName,
    };
    mocks.listDockerNetworks.mockResolvedValueOnce([toListedNetwork(reservedNetwork)]);
    mocks.inspectDockerNetwork.mockResolvedValueOnce(reservedNetwork);

    await cleanupRuntimeNetworkReservation(
      {
        networkNames: [],
        reservationId: 'dep_123',
      },
      createConfig(),
    );

    expect(mocks.removeDockerNetwork).toHaveBeenCalledWith({ networkName });
  });
});

describe('parseIpv4RouteCidrs', (): void => {
  it('ignores the default route but keeps real overlapping routes', (): void => {
    const cidrs: Ipv4Cidr[] = parseIpv4RouteCidrs(buildRouteOutput());

    expect(cidrs.map(formatIpv4Cidr)).toEqual([
      buildTestIpv4Cidr(10, 240, 0, 0, 24),
      buildTestIpv4Cidr(192, 168, 10, 8, 32),
    ]);
  });

  it('parses typed kernel routes such as blackhole routes', (): void => {
    const cidrs: Ipv4Cidr[] = parseIpv4RouteCidrs(`blackhole ${buildTestIpv4Cidr(10, 240, 0, 0, 16)}`);

    expect(cidrs.map(formatIpv4Cidr)).toEqual([buildTestIpv4Cidr(10, 240, 0, 0, 16)]);
  });
});

function createReservationRequest(
  overrides: Partial<NodeRuntimeNetworkReservationRequest> = {},
): NodeRuntimeNetworkReservationRequest {
  return {
    deploymentId: 'dep_123',
    environmentId: 'env_123',
    projectId: 'prj_123',
    requiresResourceNetwork: false,
    serviceId: 'svc_123',
    serviceNetworkEndpointReservations: 2,
    ...overrides,
  };
}

function createEndpointReservationVolume(input: {
  expiresAt?: string | undefined;
  networkName: string;
  reservationId: string;
}): DockerListVolumeResult {
  return {
    labels: {
      'compartment.namespace': dockerNamespace,
      'compartment.network.endpointReservation': 'true',
      'compartment.network.endpointReservation.expiresAt': input.expiresAt ?? '2999-01-01T00:00:00.000Z',
      'compartment.network.endpointReservation.id': input.reservationId,
      'compartment.network.endpointReservation.network': input.networkName,
    },
    name: `volume_${input.reservationId}`,
  };
}

function createConfig(poolOverrides: Partial<RuntimeNetworkPoolConfig> = {}): RuntimeNetworkCapacityConfig {
  return {
    dockerNamespace,
    runtimeConnectivityMode: 'network',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(poolOverrides),
  };
}

function createIpamConfig(subnet: string): DockerNetworkIpamConfig {
  return {
    gateway: null,
    subnet,
  };
}

function createInspectedNetwork(input: DockerEnsureNetworkInput): DockerInspectNetworkResult {
  return {
    endpointContainerIds: [],
    ipamConfigs: [createIpamConfig(input.ipam?.subnet ?? buildTestIpv4Cidr(10, 240, 255, 0, 28))],
    labels: input.labels,
    name: input.networkName,
  };
}

function createManagedServiceNetwork(
  request: NodeRuntimeNetworkReservationRequest,
  input: { endpointContainerIds: string[]; networkName: string; subnet: string },
): DockerInspectNetworkResult {
  return {
    endpointContainerIds: input.endpointContainerIds,
    ipamConfigs: [createIpamConfig(input.subnet)],
    labels: {
      'compartment.environmentId': request.environmentId,
      'compartment.namespace': dockerNamespace,
      'compartment.network.ipam': 'managed',
      'compartment.projectId': request.projectId,
      'compartment.serviceId': request.serviceId,
      [runtimeNetworkKindLabelName]: 'service',
      [runtimeNetworkPoolCidrLabelName]: createRuntimeNetworkPoolConfig().cidr,
      [runtimeNetworkSubnetLabelName]: input.subnet,
      [runtimeNetworkSubnetPrefixLabelName]: createRuntimeNetworkPoolConfig().subnetPrefixLength.toString(),
    },
    name: input.networkName,
  };
}

function toListedNetwork(network: DockerInspectNetworkResult): DockerListNetworkResult {
  return {
    ipamConfigs: network.ipamConfigs,
    labels: network.labels,
    name: network.name,
  };
}

function buildRouteOutput(): string {
  return `default via ${buildTestIpv4Address(10, 0, 0, 1)} dev eth0
${buildTestIpv4Cidr(10, 240, 0, 0, 24)} dev br-runtime proto kernel scope link src ${buildTestIpv4Address(10, 240, 0, 1)}
${buildTestIpv4Address(192, 168, 10, 8)} dev veth0 scope link`;
}

function expectPresent<TValue>(value: TValue | undefined): TValue {
  expect(value).not.toBeUndefined();
  return value as TValue;
}
