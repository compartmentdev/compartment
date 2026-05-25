import type {
  DockerInspectContainerResult,
  DockerInspectNetworkResult,
  DockerRunContainerInput,
  DockerRunContainerToCompletionResult,
} from '@compartment/docker';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { runRuntimeResourceRestoreOperation } from '../src/services/runtime-resource-operation.service';
import type { RuntimeDeployConfig } from '../src/services/runtime.types';

type ConnectDockerContainerToNetwork = (input: { containerRef: string; networkName: string }) => Promise<void>;
type EnsureDockerImageAvailable = (input: { imageRef: string }) => Promise<void>;
type EnsureDockerNetwork = (input: DockerEnsureNetworkInput) => Promise<void>;
type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResult | null>;
type InspectDockerNetwork = (input: { networkName: string }) => Promise<DockerInspectNetworkResult | null>;
type RunDockerContainerToCompletion = (input: DockerRunContainerInput) => Promise<DockerRunContainerToCompletionResult>;

interface DockerEnsureNetworkInput {
  labels: Record<string, string>;
  networkName: string;
}

interface RuntimeResourceOperationMocks {
  connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
  ensureDockerImageAvailable: Mock<EnsureDockerImageAvailable>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
}

const mocks: RuntimeResourceOperationMocks = vi.hoisted(
  (): RuntimeResourceOperationMocks => ({
    connectDockerContainerToNetwork: vi.fn<ConnectDockerContainerToNetwork>(),
    ensureDockerImageAvailable: vi.fn<EnsureDockerImageAvailable>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    runDockerContainerToCompletion: vi.fn<RunDockerContainerToCompletion>(),
  }),
);

vi.mock(
  '@compartment/docker',
  (): {
    buildDockerNamespaceLabels: (namespace: string) => Record<string, string>;
    compartmentDockerNamespaceLabelName: string;
    connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
    ensureDockerImageAvailable: Mock<EnsureDockerImageAvailable>;
    ensureDockerNetwork: Mock<EnsureDockerNetwork>;
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
    runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
  } => ({
    buildDockerNamespaceLabels: (namespace: string): Record<string, string> => ({
      'compartment.namespace': namespace,
    }),
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    connectDockerContainerToNetwork: mocks.connectDockerContainerToNetwork,
    ensureDockerImageAvailable: mocks.ensureDockerImageAvailable,
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
    runDockerContainerToCompletion: mocks.runDockerContainerToCompletion,
  }),
);

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
  mocks.connectDockerContainerToNetwork.mockReset();
  mocks.ensureDockerImageAvailable.mockReset();
  mocks.ensureDockerNetwork.mockReset();
  mocks.inspectDockerContainer.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.runDockerContainerToCompletion.mockReset();
});

describe('runRuntimeResourceRestoreOperation', (): void => {
  it('probes restore readiness through the resource container network address', async (): Promise<void> => {
    const resourceNetworkAddress: string = ['172', '20', '0', '15'].join('.');

    mocks.inspectDockerContainer.mockResolvedValue({
      containerId: 'resource_container_123',
      imageRef: 'postgres:16',
      isRunning: true,
      labels: {},
      networkAttachments: [{ ipAddress: resourceNetworkAddress, name: 'compartment-test-prj-123-env-123-resources' }],
      publishedPorts: [],
    });
    mocks.runDockerContainerToCompletion.mockResolvedValue({
      containerId: 'operation_container_123',
      logs: [],
      stderr: '',
      stdout: 'ok',
    });

    await expect(
      runRuntimeResourceRestoreOperation(
        {
          artifactHostPath: '/var/lib/compartment/resource-backups/rbak_123',
          definition: {
            command: 'psql < "$COMPARTMENT_BACKUP_DIR/dump.sql"',
            env: [],
            image: 'postgres:16',
          },
          environmentId: 'env_123',
          environmentName: 'production',
          projectId: 'prj_123',
          projectName: 'internal-tools',
          readiness: { port: 5432, timeoutMs: 1, type: 'tcp' },
          resourceHostname: 'postgres.production.internal-tools.resource.internal',
          resourceName: 'postgres',
        },
        createRuntimeConfig(),
      ),
    ).rejects.toThrow('Resource postgres did not become ready after restore before 1ms.');

    expect(mocks.inspectDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-test-internal-tools-production-resource-postgres',
    });
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledWith({
      labels: {
        'compartment.namespace': 'test',
      },
      networkName: 'compartment-test-prj-123-env-123-resources',
    });
    const operationContainerInput: DockerRunContainerInput | undefined =
      mocks.runDockerContainerToCompletion.mock.calls[0]?.[0];
    expect(operationContainerInput?.labels).toEqual(
      expect.objectContaining({
        'compartment.environmentId': 'env_123',
        'compartment.namespace': 'test',
        'compartment.projectId': 'prj_123',
        'compartment.resource': 'postgres',
      }),
    );
  });

  it('rejects operation containers before joining an unowned resource network', async (): Promise<void> => {
    mocks.ensureDockerNetwork.mockRejectedValueOnce(
      new Error(
        'Docker network compartment-test-prj-123-env-123-resources exists without required label compartment.namespace=test.',
      ),
    );

    await expect(
      runRuntimeResourceRestoreOperation(
        {
          artifactHostPath: '/var/lib/compartment/resource-backups/rbak_123',
          definition: {
            command: 'psql < "$COMPARTMENT_BACKUP_DIR/dump.sql"',
            env: [],
            image: 'postgres:16',
          },
          environmentId: 'env_123',
          environmentName: 'production',
          projectId: 'prj_123',
          projectName: 'internal-tools',
          readiness: null,
          resourceHostname: 'postgres.production.internal-tools.resource.internal',
          resourceName: 'postgres',
        },
        createRuntimeConfig(),
      ),
    ).rejects.toThrow(
      'Docker network compartment-test-prj-123-env-123-resources exists without required label compartment.namespace=test.',
    );
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });
});

function createRuntimeConfig(): RuntimeDeployConfig {
  return {
    appPortEnd: 39_000,
    appPortStart: 38_000,
    dockerNamespace: 'test',
    runtimeConnectivityMode: 'network',
    runtimeDefaultUpstreamHost: 'host.docker.internal',
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
  };
}
