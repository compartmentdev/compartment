import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { isDockerNetworkIpamCapacityError } from '../src/docker-engine-error';
import { ensureDockerNetwork, inspectDockerNetwork, listDockerNetworks } from '../src/docker-network';
import { ensureDockerVolume, listDockerVolumes } from '../src/docker-volume';

type CreateDockerClient = () => Promise<MockDockerClient>;
type DockerCreateNetwork = (options: MockDockerCreateNetworkOptions) => Promise<void>;
type DockerCreateVolume = (options: MockDockerCreateVolumeOptions) => Promise<void>;
type DockerGetNetwork = (networkName: string) => MockDockerNetwork;
type DockerGetVolume = (volumeName: string) => MockDockerVolume;
type DockerListNetworks = () => Promise<MockDockerNetworkInspectInfo[]>;
type DockerListVolumes = (options: MockDockerListVolumesOptions) => Promise<MockDockerListVolumesResult>;
type DockerNetworkInspect = () => Promise<MockDockerNetworkInspectInfo>;
type DockerVolumeInspect = () => Promise<MockDockerVolumeInspectInfo>;

interface DockerNetworkTestMocks {
  createDockerClient: Mock<CreateDockerClient>;
}

interface MockDockerClient {
  createNetwork: Mock<DockerCreateNetwork>;
  createVolume: Mock<DockerCreateVolume>;
  getNetwork: Mock<DockerGetNetwork>;
  getVolume: Mock<DockerGetVolume>;
  listNetworks: Mock<DockerListNetworks>;
  listVolumes: Mock<DockerListVolumes>;
}

interface MockDockerCreateNetworkOptions {
  CheckDuplicate: true;
  IPAM?: { Config: { Subnet: string }[] } | undefined;
  Labels: Record<string, string>;
  Name: string;
}

interface MockDockerCreateVolumeOptions {
  Labels: Record<string, string>;
  Name: string;
}

interface MockDockerListVolumesOptions {
  filters?: {
    label: string[];
  };
}

interface MockDockerListVolumesResult {
  Volumes?: MockDockerVolumeInspectInfo[] | null;
}

interface DockerListVolumesNormalizationCase {
  response: MockDockerListVolumesResult;
  title: string;
}

interface MockDockerNetwork {
  inspect: Mock<DockerNetworkInspect>;
}

interface MockDockerVolume {
  inspect: Mock<DockerVolumeInspect>;
}

interface MockDockerNetworkInspectInfo {
  Containers?: Record<string, { Name?: string | undefined }> | undefined;
  IPAM?: { Config?: MockDockerNetworkIpamConfig[] | undefined } | undefined;
  Labels?: Record<string, string> | undefined;
  Name: string;
}

interface MockDockerNetworkIpamConfig {
  Gateway?: string | undefined;
  Subnet?: string | undefined;
}

interface MockDockerVolumeInspectInfo {
  Labels?: Record<string, string> | undefined;
  Name: string;
}

const mocks: DockerNetworkTestMocks = vi.hoisted(
  (): DockerNetworkTestMocks => ({
    createDockerClient: vi.fn<CreateDockerClient>(),
  }),
);

const dockerListVolumesNormalizationCases: DockerListVolumesNormalizationCase[] = [
  { response: { Volumes: null }, title: 'null Volumes' },
  { response: {}, title: 'missing Volumes' },
];

vi.mock('../src/docker-client', (): { createDockerClient: Mock<CreateDockerClient>; hasText: typeof hasText } => ({
  createDockerClient: mocks.createDockerClient,
  hasText,
}));

afterEach((): void => {
  mocks.createDockerClient.mockReset();
});

describe('ensureDockerNetwork', (): void => {
  it('rejects missing ownership labels', async (): Promise<void> => {
    await expect(
      ensureDockerNetwork({
        labels: {},
        networkName: 'runtime',
      }),
    ).rejects.toThrow('Docker network runtime requires at least one ownership label.');
    expect(mocks.createDockerClient).not.toHaveBeenCalled();
  });

  it('creates missing networks with required labels', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      inspectError: { message: 'No such network: runtime' },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await ensureDockerNetwork({
      labels: {
        'compartment.namespace': 'compartment-prod',
      },
      networkName: 'runtime',
    });

    expect(dockerClient.createNetwork).toHaveBeenCalledWith({
      CheckDuplicate: true,
      Labels: {
        'compartment.namespace': 'compartment-prod',
      },
      Name: 'runtime',
    });
  });

  it('creates missing networks with explicit IPAM when provided', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      inspectError: { message: 'No such network: runtime' },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);
    const subnet: string = buildIpv4Cidr([10, 240, 0, 0], 28);

    await ensureDockerNetwork({
      ipam: {
        subnet,
      },
      labels: {
        'compartment.namespace': 'compartment-prod',
      },
      networkName: 'runtime',
    });

    expect(dockerClient.createNetwork).toHaveBeenCalledWith({
      CheckDuplicate: true,
      IPAM: {
        Config: [
          {
            Subnet: subnet,
          },
        ],
      },
      Labels: {
        'compartment.namespace': 'compartment-prod',
      },
      Name: 'runtime',
    });
  });

  it('accepts existing networks with matching required labels', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      inspectResult: {
        Labels: {
          'compartment.namespace': 'compartment-prod',
        },
        Name: 'runtime',
      },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await ensureDockerNetwork({
      labels: {
        'compartment.namespace': 'compartment-prod',
      },
      networkName: 'runtime',
    });

    expect(dockerClient.createNetwork).not.toHaveBeenCalled();
  });

  it('rejects existing networks without the requested explicit IPAM subnet', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      inspectResult: {
        IPAM: {
          Config: [
            {
              Subnet: buildIpv4Cidr([10, 240, 0, 16], 28),
            },
          ],
        },
        Labels: {
          'compartment.namespace': 'compartment-prod',
        },
        Name: 'runtime',
      },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      ensureDockerNetwork({
        ipam: {
          subnet: buildIpv4Cidr([10, 240, 0, 0], 28),
        },
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        networkName: 'runtime',
      }),
    ).rejects.toThrow(
      `Docker network runtime exists without required IPAM subnet ${buildIpv4Cidr([10, 240, 0, 0], 28)}.`,
    );
    expect(dockerClient.createNetwork).not.toHaveBeenCalled();
  });

  it('rejects existing networks without matching required labels', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      inspectResult: {
        Labels: {
          'compartment.namespace': 'other',
        },
        Name: 'runtime',
      },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      ensureDockerNetwork({
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        networkName: 'runtime',
      }),
    ).rejects.toThrow('Docker network runtime exists without required label compartment.namespace=compartment-prod.');
    expect(dockerClient.createNetwork).not.toHaveBeenCalled();
  });

  it('re-inspects network creation conflicts before accepting the network', async (): Promise<void> => {
    const network: MockDockerNetwork = {
      inspect: vi
        .fn<DockerNetworkInspect>()
        .mockRejectedValueOnce({ message: 'No such network: runtime' })
        .mockResolvedValueOnce({
          Labels: {
            'compartment.namespace': 'other',
          },
          Name: 'runtime',
        }),
    };
    const dockerClient: MockDockerClient = createMockDockerClient({});
    dockerClient.createNetwork.mockRejectedValueOnce({ statusCode: 409 });
    dockerClient.getNetwork.mockReturnValue(network);
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      ensureDockerNetwork({
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        networkName: 'runtime',
      }),
    ).rejects.toThrow('Docker network runtime exists without required label compartment.namespace=compartment-prod.');
    expect(network.inspect).toHaveBeenCalledTimes(2);
  });

  it('re-inspects network creation conflicts before accepting requested IPAM', async (): Promise<void> => {
    const network: MockDockerNetwork = {
      inspect: vi
        .fn<DockerNetworkInspect>()
        .mockRejectedValueOnce({ message: 'No such network: runtime' })
        .mockResolvedValueOnce({
          IPAM: {
            Config: [
              {
                Subnet: buildIpv4Cidr([10, 240, 0, 16], 28),
              },
            ],
          },
          Labels: {
            'compartment.namespace': 'compartment-prod',
          },
          Name: 'runtime',
        }),
    };
    const dockerClient: MockDockerClient = createMockDockerClient({});
    dockerClient.createNetwork.mockRejectedValueOnce({ statusCode: 409 });
    dockerClient.getNetwork.mockReturnValue(network);
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      ensureDockerNetwork({
        ipam: {
          subnet: buildIpv4Cidr([10, 240, 0, 0], 28),
        },
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        networkName: 'runtime',
      }),
    ).rejects.toThrow(
      `Docker network runtime exists without required IPAM subnet ${buildIpv4Cidr([10, 240, 0, 0], 28)}.`,
    );
    expect(network.inspect).toHaveBeenCalledTimes(2);
  });
});

describe('ensureDockerVolume', (): void => {
  it('rejects missing ownership labels', async (): Promise<void> => {
    await expect(
      ensureDockerVolume({
        labels: {},
        volumeName: 'runtime-reservation',
      }),
    ).rejects.toThrow('Docker volume runtime-reservation requires at least one ownership label.');
    expect(mocks.createDockerClient).not.toHaveBeenCalled();
  });

  it('creates missing volumes with required labels', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      volumeInspectError: { message: 'No such volume: runtime-reservation' },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await ensureDockerVolume({
      labels: {
        'compartment.namespace': 'compartment-prod',
      },
      volumeName: 'runtime-reservation',
    });

    expect(dockerClient.createVolume).toHaveBeenCalledWith({
      Labels: {
        'compartment.namespace': 'compartment-prod',
      },
      Name: 'runtime-reservation',
    });
  });

  it('rejects existing volumes without matching labels', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      volumeInspectResult: {
        Labels: {
          'compartment.namespace': 'other',
        },
        Name: 'runtime-reservation',
      },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      ensureDockerVolume({
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        volumeName: 'runtime-reservation',
      }),
    ).rejects.toThrow(
      'Docker volume runtime-reservation exists without required label compartment.namespace=compartment-prod.',
    );
  });

  it('rejects existing unlabeled volumes with a required label error', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      volumeInspectResult: {
        Name: 'runtime-reservation',
      },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      ensureDockerVolume({
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        volumeName: 'runtime-reservation',
      }),
    ).rejects.toThrow(
      'Docker volume runtime-reservation exists without required label compartment.namespace=compartment-prod.',
    );
  });
});

describe('inspectDockerNetwork', (): void => {
  it('preserves daemon labels for runtime ownership checks', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({
      inspectResult: {
        Containers: {},
        Labels: {
          'compartment.namespace': 'compartment-prod',
        },
        Name: 'runtime',
      },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(inspectDockerNetwork({ networkName: 'runtime' })).resolves.toEqual({
      endpointContainerIds: [],
      ipamConfigs: [],
      labels: {
        'compartment.namespace': 'compartment-prod',
      },
      name: 'runtime',
    });
  });

  it('preserves network IPAM subnets and gateways for runtime egress rules', async (): Promise<void> => {
    const gateway: string = buildIpv4Address([172, 30, 0, 1]);
    const subnet: string = buildIpv4Cidr([172, 30, 0, 0], 16);
    const dockerClient: MockDockerClient = createMockDockerClient({
      inspectResult: {
        IPAM: {
          Config: [
            {
              Gateway: gateway,
              Subnet: subnet,
            },
            {
              Subnet: '2001:db8::/64',
            },
            {},
          ],
        },
        Name: 'runtime',
      },
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(inspectDockerNetwork({ networkName: 'runtime' })).resolves.toEqual({
      endpointContainerIds: [],
      ipamConfigs: [
        {
          gateway,
          subnet,
        },
        {
          gateway: null,
          subnet: '2001:db8::/64',
        },
      ],
      labels: {},
      name: 'runtime',
    });
  });
});

describe('listDockerNetworks', (): void => {
  it('preserves daemon labels for runtime ownership discovery', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({});
    dockerClient.listNetworks.mockResolvedValueOnce([
      {
        IPAM: {
          Config: [
            {
              Gateway: buildIpv4Address([10, 240, 0, 1]),
              Subnet: buildIpv4Cidr([10, 240, 0, 0], 28),
            },
          ],
        },
        Labels: {
          'compartment.namespace': 'compartment-prod',
        },
        Name: 'runtime',
      },
    ]);
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(listDockerNetworks()).resolves.toEqual([
      {
        ipamConfigs: [
          {
            gateway: buildIpv4Address([10, 240, 0, 1]),
            subnet: buildIpv4Cidr([10, 240, 0, 0], 28),
          },
        ],
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        name: 'runtime',
      },
    ]);
  });
});

describe('listDockerVolumes', (): void => {
  it.each(dockerListVolumesNormalizationCases)(
    'normalizes $title to an empty volume list',
    async ({ response }: DockerListVolumesNormalizationCase): Promise<void> => {
      const dockerClient: MockDockerClient = createMockDockerClient({});
      dockerClient.listVolumes.mockResolvedValueOnce(response);
      mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

      await expect(listDockerVolumes()).resolves.toEqual([]);
    },
  );

  it('passes label filters and preserves daemon labels', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({});
    dockerClient.listVolumes.mockResolvedValueOnce({
      Volumes: [
        {
          Labels: {
            'compartment.namespace': 'compartment-prod',
          },
          Name: 'runtime-reservation',
        },
      ],
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      listDockerVolumes({
        labelFilters: {
          'compartment.namespace': 'compartment-prod',
        },
      }),
    ).resolves.toEqual([
      {
        labels: {
          'compartment.namespace': 'compartment-prod',
        },
        name: 'runtime-reservation',
      },
    ]);
    expect(dockerClient.listVolumes).toHaveBeenCalledWith({
      filters: {
        label: ['compartment.namespace=compartment-prod'],
      },
    });
  });

  it('passes key-only label filters for label-exists matching', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({});
    dockerClient.listVolumes.mockResolvedValueOnce({ Volumes: [] });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(
      listDockerVolumes({
        labelFilters: {
          'compartment.runtime-network-reservation': undefined,
        },
      }),
    ).resolves.toEqual([]);
    expect(dockerClient.listVolumes).toHaveBeenCalledWith({
      filters: {
        label: ['compartment.runtime-network-reservation'],
      },
    });
  });

  it('normalizes missing volume labels to an empty object', async (): Promise<void> => {
    const dockerClient: MockDockerClient = createMockDockerClient({});
    dockerClient.listVolumes.mockResolvedValueOnce({
      Volumes: [
        {
          Name: 'runtime-reservation',
        },
      ],
    });
    mocks.createDockerClient.mockResolvedValueOnce(dockerClient);

    await expect(listDockerVolumes()).resolves.toEqual([
      {
        labels: {},
        name: 'runtime-reservation',
      },
    ]);
  });
});

describe('isDockerNetworkIpamCapacityError', (): void => {
  it('classifies Docker endpoint IP exhaustion as network capacity exhaustion', (): void => {
    expect(
      isDockerNetworkIpamCapacityError({
        json: {
          message: 'no available IPv4 addresses on this network endpoint pool',
        },
        statusCode: 500,
      }),
    ).toBe(true);
  });

  it('does not classify generic network lookup failures as IPAM capacity exhaustion', (): void => {
    expect(
      isDockerNetworkIpamCapacityError({
        json: {
          message: 'no available network named runtime',
        },
        statusCode: 404,
      }),
    ).toBe(false);
  });
});

function createMockDockerClient(input: {
  inspectError?: object | undefined;
  inspectResult?: MockDockerNetworkInspectInfo | undefined;
  volumeInspectError?: object | undefined;
  volumeInspectResult?: MockDockerVolumeInspectInfo | undefined;
}): MockDockerClient {
  const network: MockDockerNetwork = {
    inspect: vi.fn<DockerNetworkInspect>(),
  };
  const volume: MockDockerVolume = {
    inspect: vi.fn<DockerVolumeInspect>(),
  };
  if (input.inspectError !== undefined) {
    network.inspect.mockRejectedValue(input.inspectError);
  } else {
    network.inspect.mockResolvedValue(input.inspectResult ?? { Name: 'runtime' });
  }
  if (input.volumeInspectError !== undefined) {
    volume.inspect.mockRejectedValue(input.volumeInspectError);
  } else {
    volume.inspect.mockResolvedValue(input.volumeInspectResult ?? { Name: 'runtime-reservation' });
  }

  return {
    createNetwork: vi.fn<DockerCreateNetwork>().mockResolvedValue(undefined),
    createVolume: vi.fn<DockerCreateVolume>().mockResolvedValue(undefined),
    getNetwork: vi.fn<DockerGetNetwork>().mockReturnValue(network),
    getVolume: vi.fn<DockerGetVolume>().mockReturnValue(volume),
    listNetworks: vi.fn<DockerListNetworks>().mockResolvedValue([]),
    listVolumes: vi.fn<DockerListVolumes>().mockResolvedValue({ Volumes: [] }),
  };
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv4Cidr(octets: readonly [number, number, number, number], prefixLength: number): string {
  return `${buildIpv4Address(octets)}/${prefixLength.toString()}`;
}
