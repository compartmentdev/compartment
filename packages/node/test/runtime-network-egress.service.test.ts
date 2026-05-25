import type {
  DockerInspectContainerResult,
  DockerInspectNetworkResult,
  DockerNetworkIpamConfig,
} from '@compartment/docker';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { buildDbNetworkName, buildSystemNetworkName } from '../src/services/runtime-names.service';
import { syncRuntimeNetworkEgressDenyRules } from '../src/services/runtime-network-egress.service';

interface DockerSyncNetworkEgressDenyRulesInput {
  destinationCidrs: string[];
  namespace: string;
  sourceAllowCidrs?: string[] | undefined;
  sourceSubnets: string[];
}

type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResult | null>;
type InspectDockerNetwork = (input: { networkName: string }) => Promise<DockerInspectNetworkResult | null>;
type SyncDockerNetworkEgressDenyRules = (input: DockerSyncNetworkEgressDenyRulesInput) => Promise<void>;

interface RuntimeNetworkEgressServiceMocks {
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  syncDockerNetworkEgressDenyRules: Mock<SyncDockerNetworkEgressDenyRules>;
}

const mocks: RuntimeNetworkEgressServiceMocks = vi.hoisted(
  (): RuntimeNetworkEgressServiceMocks => ({
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    syncDockerNetworkEgressDenyRules: vi.fn<SyncDockerNetworkEgressDenyRules>(),
  }),
);

vi.mock(
  '@compartment/docker',
  (): {
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
    syncDockerNetworkEgressDenyRules: Mock<SyncDockerNetworkEgressDenyRules>;
  } => ({
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
    syncDockerNetworkEgressDenyRules: mocks.syncDockerNetworkEgressDenyRules,
  }),
);

afterEach((): void => {
  mocks.inspectDockerContainer.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.syncDockerNetworkEgressDenyRules.mockReset();
});

describe('syncRuntimeNetworkEgressDenyRules', (): void => {
  it('derives source and denied destination CIDRs from Docker network IPAM', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';
    const dbSubnet: string = buildIpv4Cidr([172, 33, 0, 0], 16);
    const resourceGateway: string = buildIpv4Address([172, 31, 0, 1]);
    const resourceSubnet: string = buildIpv4Cidr([172, 31, 0, 0], 16);
    const serviceGateway: string = buildIpv4Address([172, 30, 0, 1]);
    const servicePlatformIpAddress: string = buildIpv4Address([172, 30, 0, 2]);
    const serviceSubnet: string = buildIpv4Cidr([172, 30, 0, 0], 16);
    const systemSubnet: string = buildIpv4Cidr([172, 32, 0, 0], 16);
    const serviceNetworkName: string = 'compartment-compartment-test-prj-env-web';
    const resourceNetworkName: string = 'compartment-compartment-test-prj-env-resources';
    const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
    const dbNetworkName: string = buildDbNetworkName(dockerNamespace);

    mocks.inspectDockerNetwork.mockImplementation(
      async ({ networkName }: { networkName: string }): Promise<DockerInspectNetworkResult | null> =>
        await Promise.resolve(
          readInspectedNetworkFromMap(networkName, {
            [dbNetworkName]: createNetwork(dbNetworkName, [
              { gateway: buildIpv4Address([172, 33, 0, 1]), subnet: dbSubnet },
            ]),
            [resourceNetworkName]: createNetwork(resourceNetworkName, [
              { gateway: resourceGateway, subnet: resourceSubnet },
            ]),
            [serviceNetworkName]: createNetwork(serviceNetworkName, [
              { gateway: serviceGateway, subnet: serviceSubnet },
              { gateway: '2001:db8::1', subnet: '2001:db8::/64' },
            ]),
            [systemNetworkName]: createNetwork(systemNetworkName, [
              { gateway: buildIpv4Address([172, 32, 0, 1]), subnet: systemSubnet },
            ]),
          }),
        ),
    );
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'caddy_container',
      imageRef: 'sha256:caddy',
      isRunning: true,
      labels: {},
      networkAttachments: [
        { ipAddress: servicePlatformIpAddress, name: serviceNetworkName },
        { ipAddress: buildIpv4Address([172, 99, 0, 2]), name: 'monitoring' },
        { ipAddress: '2001:db8::2', name: serviceNetworkName },
        { ipAddress: null, name: resourceNetworkName },
      ],
      publishedPorts: [],
    });

    await syncRuntimeNetworkEgressDenyRules({
      dockerNamespace,
      networkNames: [serviceNetworkName, resourceNetworkName],
      platformSourceContainerRefs: ['caddy_container'],
    });

    expect(mocks.syncDockerNetworkEgressDenyRules).toHaveBeenCalledWith({
      destinationCidrs: [
        buildIpv4Cidr([169, 254, 0, 0], 16),
        buildIpv4Cidr([169, 254, 169, 254], 32),
        buildHostCidr(serviceGateway),
        buildHostCidr(resourceGateway),
        systemSubnet,
        dbSubnet,
      ],
      namespace: dockerNamespace,
      sourceAllowCidrs: [buildHostCidr(servicePlatformIpAddress)],
      sourceSubnets: [serviceSubnet, resourceSubnet],
    });
  });

  it('clears namespace rules when there are no runtime network sources', async (): Promise<void> => {
    const dockerNamespace: string = 'compartment-test';

    await syncRuntimeNetworkEgressDenyRules({
      dockerNamespace,
      networkNames: [],
    });

    expect(mocks.inspectDockerNetwork).not.toHaveBeenCalled();
    expect(mocks.syncDockerNetworkEgressDenyRules).toHaveBeenCalledWith({
      destinationCidrs: [],
      namespace: dockerNamespace,
      sourceAllowCidrs: [],
      sourceSubnets: [],
    });
  });
});

function createNetwork(name: string, ipamConfigs: DockerNetworkIpamConfig[]): DockerInspectNetworkResult {
  return {
    endpointContainerIds: [],
    ipamConfigs,
    labels: {},
    name,
  };
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv4Cidr(octets: readonly [number, number, number, number], prefixLength: number): string {
  return `${buildIpv4Address(octets)}/${prefixLength.toString()}`;
}

function buildHostCidr(address: string): string {
  return `${address}/32`;
}

function readInspectedNetworkFromMap(
  networkName: string,
  networks: Record<string, DockerInspectNetworkResult>,
): DockerInspectNetworkResult | null {
  return networks[networkName] ?? null;
}
