import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DockerListNetworkResult } from '@compartment/docker';
import type { NodeConfig } from '../src/config';
import { buildRuntimeServiceNetworkName } from '../src/services/runtime-names.service';
import { reconcileRuntimeNetworksOnStartup } from '../src/services/startup-runtime-network.service';
import type { RuntimeDeployConfig } from '../src/services/runtime.types';
import { buildTestIpv4Cidr, createRuntimeNetworkPoolConfig } from './runtime-network-pool.fixture';

type ExecFile = (file: string, args: string[], callback: ExecFileCallback) => void;
type ListDockerNetworks = () => Promise<DockerListNetworkResult[]>;
type ReconcileRuntimeNetworks = (config: RuntimeDeployConfig) => Promise<void>;
type WaitForRetry = (delayMs: number) => Promise<void>;

interface StartupRuntimeNetworkLogger {
  warn(payload: StartupRuntimeNetworkLogPayload, message: string): void;
}

interface StartupRuntimeNetworkLogPayload {
  attempt: number;
  maxAttempts: number;
}

const mocks: {
  execFile: Mock<ExecFile>;
  listDockerNetworks: Mock<ListDockerNetworks>;
  reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks>;
} = vi.hoisted(
  (): {
    execFile: Mock<ExecFile>;
    listDockerNetworks: Mock<ListDockerNetworks>;
    reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks>;
  } => ({
    execFile: vi.fn<ExecFile>(),
    listDockerNetworks: vi.fn<ListDockerNetworks>(),
    reconcileRuntimeNetworks: vi.fn<ReconcileRuntimeNetworks>(),
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
    listDockerNetworks: Mock<ListDockerNetworks>;
  } => ({
    buildDockerNamespaceLabels: (namespace: string): Record<string, string> => ({
      'compartment.namespace': namespace,
    }),
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    listDockerNetworks: mocks.listDockerNetworks,
  }),
);

vi.mock(
  '../src/services/runtime-network.service',
  (): { reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks> } => ({
    reconcileRuntimeNetworks: mocks.reconcileRuntimeNetworks,
  }),
);

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

beforeEach((): void => {
  mocks.execFile.mockImplementation((_file: string, _args: string[], callback: ExecFileCallback): void => {
    callback(null, '', '');
  });
  mocks.listDockerNetworks.mockResolvedValue([]);
});

afterEach((): void => {
  mocks.execFile.mockReset();
  mocks.listDockerNetworks.mockReset();
  mocks.reconcileRuntimeNetworks.mockReset();
});

describe('reconcileRuntimeNetworksOnStartup', (): void => {
  it('does not block node startup when caddy never becomes ready', async (): Promise<void> => {
    const warnings: string[] = [];
    const logger: StartupRuntimeNetworkLogger = createStartupRuntimeNetworkLogger(warnings);
    const waitForRetry: WaitForRetry = async (): Promise<void> => {
      await Promise.resolve();
    };
    mocks.reconcileRuntimeNetworks.mockRejectedValue(new Error('Expected one running caddy container.'));

    await expect(reconcileRuntimeNetworksOnStartup(createNodeConfig(), logger, waitForRetry)).resolves.toBeUndefined();

    expect(mocks.reconcileRuntimeNetworks).toHaveBeenCalledTimes(20);
    expect(warnings).toContain(
      'Runtime network actors did not become ready during node startup. Runtime operations will reconcile networks on demand.',
    );
  });

  it('still fails startup for non-runtime-actor errors', async (): Promise<void> => {
    const warnings: string[] = [];
    const logger: StartupRuntimeNetworkLogger = createStartupRuntimeNetworkLogger(warnings);
    const waitForRetry: WaitForRetry = async (): Promise<void> => {
      await Promise.resolve();
    };
    mocks.reconcileRuntimeNetworks.mockRejectedValue(new Error('Docker daemon is unavailable.'));

    await expect(reconcileRuntimeNetworksOnStartup(createNodeConfig(), logger, waitForRetry)).rejects.toThrow(
      'Docker daemon is unavailable.',
    );
    expect(warnings).toHaveLength(0);
  });

  it('fails startup when the runtime network pool overlaps a foreign Docker network', async (): Promise<void> => {
    const poolCidr: string = buildTestIpv4Cidr(10, 240, 0, 0, 24);
    const foreignSubnet: string = buildTestIpv4Cidr(10, 240, 0, 0, 28);
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        ipamConfigs: [
          {
            gateway: null,
            subnet: foreignSubnet,
          },
        ],
        labels: {},
        name: 'foreign-network',
      },
    ]);

    await expect(
      reconcileRuntimeNetworksOnStartup(createNodeConfig(), createStartupRuntimeNetworkLogger([])),
    ).rejects.toThrow(`Runtime network pool ${poolCidr} overlaps Docker network ${foreignSubnet}.`);
    expect(mocks.reconcileRuntimeNetworks).not.toHaveBeenCalled();
  });

  it('fails startup when an unmanaged runtime-name Docker network overlaps the managed pool', async (): Promise<void> => {
    const ownedSubnet: string = buildTestIpv4Cidr(10, 240, 0, 0, 28);
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        ipamConfigs: [
          {
            gateway: null,
            subnet: ownedSubnet,
          },
        ],
        labels: {
          'compartment.namespace': 'compartment-test',
        },
        name: buildRuntimeServiceNetworkName(
          {
            environmentId: 'env_123',
            projectId: 'prj_123',
            serviceId: 'svc_123',
          },
          'compartment-test',
        ),
      },
    ]);
    mocks.execFile.mockImplementationOnce((_file: string, _args: string[], callback: ExecFileCallback): void => {
      callback(null, `${ownedSubnet} dev br-runtime proto kernel scope link`, '');
    });

    await expect(
      reconcileRuntimeNetworksOnStartup(createNodeConfig(), createStartupRuntimeNetworkLogger([])),
    ).rejects.toThrow(
      `Runtime network pool ${buildTestIpv4Cidr(10, 240, 0, 0, 24)} overlaps Docker network ${ownedSubnet}.`,
    );
    expect(mocks.reconcileRuntimeNetworks).not.toHaveBeenCalled();
  });

  it('validates runtime network pool overlap even in loopback mode', async (): Promise<void> => {
    const poolCidr: string = buildTestIpv4Cidr(10, 240, 0, 0, 24);
    const foreignSubnet: string = buildTestIpv4Cidr(10, 240, 0, 0, 28);
    mocks.listDockerNetworks.mockResolvedValueOnce([
      {
        ipamConfigs: [
          {
            gateway: null,
            subnet: foreignSubnet,
          },
        ],
        labels: {},
        name: 'foreign-network',
      },
    ]);

    await expect(
      reconcileRuntimeNetworksOnStartup(
        createNodeConfig({ runtimeConnectivityMode: 'loopback' }),
        createStartupRuntimeNetworkLogger([]),
      ),
    ).rejects.toThrow(`Runtime network pool ${poolCidr} overlaps Docker network ${foreignSubnet}.`);
    expect(mocks.reconcileRuntimeNetworks).not.toHaveBeenCalled();
  });
});

function createStartupRuntimeNetworkLogger(warnings: string[]): StartupRuntimeNetworkLogger {
  return new TestStartupRuntimeNetworkLogger(warnings);
}

class TestStartupRuntimeNetworkLogger implements StartupRuntimeNetworkLogger {
  readonly #warnings: string[];

  constructor(warnings: string[]) {
    this.#warnings = warnings;
  }

  warn(_payload: StartupRuntimeNetworkLogPayload, message: string): void {
    this.#warnings.push(message);
  }
}

function createNodeConfig(overrides: Partial<Pick<NodeConfig, 'runtimeConnectivityMode'>> = {}): NodeConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    appPortEnd: 31999,
    appPortStart: 31000,
    dockerNamespace: 'compartment-test',
    logLevel: 'info',
    name: 'local-node',
    nodeSocketPath: '/tmp/compartment/node-test/node/agent.sock',
    resourceBackupDirectory: '/var/lib/compartment/resource-backups',
    runtimeConnectivityMode: 'network',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
    runtimeGid: 10001,
    runtimeUid: 10001,
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    runtimeSocketGid: 10001,
    version: '0.1.0',
    runtimeControlToken: 'test-runtime-control-token',
    ...overrides,
  };
}
