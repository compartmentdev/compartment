import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DockerInspectContainerResult,
  DockerInspectNetworkResult,
  DockerRunContainerInput,
  DockerRunContainerToCompletionResult,
} from '@compartment/docker';
import { nodeRuntimeResourceReadinessFailedErrorCode, type NodeResourceOperationRequest } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { isNodeRuntimeError } from '../src/errors/node-runtime-error';
import {
  runRuntimeResourceBackupOperation,
  runRuntimeResourceRestoreOperation,
} from '../src/services/runtime-resource-operation.service';
import type { RuntimeResourceOperationConfig } from '../src/services/runtime.types';

type CanConnectToRuntimeHost = (host: string, port: number, deadline: number) => Promise<boolean>;
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

interface RuntimeResourceConnectivityModule {
  canConnectToRuntimeHost: CanConnectToRuntimeHost;
  resolveRuntimeContainerNetworkHost: (containerRef: string, networkName: string) => Promise<string>;
}

interface RuntimeResourceOperationMocks {
  canConnectToRuntimeHost: Mock<CanConnectToRuntimeHost>;
  connectDockerContainerToNetwork: Mock<ConnectDockerContainerToNetwork>;
  ensureDockerImageAvailable: Mock<EnsureDockerImageAvailable>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  inspectDockerContainer: Mock<InspectDockerContainer>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  runDockerContainerToCompletion: Mock<RunDockerContainerToCompletion>;
}

const mocks: RuntimeResourceOperationMocks = vi.hoisted(
  (): RuntimeResourceOperationMocks => ({
    canConnectToRuntimeHost: vi.fn<CanConnectToRuntimeHost>(),
    connectDockerContainerToNetwork: vi.fn<ConnectDockerContainerToNetwork>(),
    ensureDockerImageAvailable: vi.fn<EnsureDockerImageAvailable>(),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    runDockerContainerToCompletion: vi.fn<RunDockerContainerToCompletion>(),
  }),
);

vi.mock(
  '../src/services/runtime-resource-connectivity.service',
  async (
    importOriginal: () => Promise<RuntimeResourceConnectivityModule>,
  ): Promise<RuntimeResourceConnectivityModule> => {
    const original: RuntimeResourceConnectivityModule = await importOriginal();
    return {
      ...original,
      canConnectToRuntimeHost: mocks.canConnectToRuntimeHost.mockImplementation(original.canConnectToRuntimeHost),
    };
  },
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
const temporaryDirectories: string[] = [];

beforeEach((): void => {
  process.env.HOSTNAME = nodeContainerRef;
});

afterEach(async (): Promise<void> => {
  mocks.canConnectToRuntimeHost.mockClear();
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
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe('runRuntimeResourceRestoreOperation', (): void => {
  it('performs an initial readiness probe before the restore timeout expires', async (): Promise<void> => {
    const dateNowSpy: MockInstance<typeof Date.now> = vi
      .spyOn(Date, 'now')
      .mockImplementationOnce((): number => 1_000)
      .mockImplementation((): number => 1_001);
    const backupArtifact: RuntimeResourceBackupArtifactFixture = await createResourceBackupArtifactFixture();
    mocks.canConnectToRuntimeHost.mockResolvedValueOnce(true);

    mocks.inspectDockerContainer.mockResolvedValue({
      containerId: 'resource_container_123',
      imageRef: 'postgres:16',
      isRunning: true,
      labels: {},
      networkAttachments: [{ ipAddress: '127.0.0.1', name: 'compartment-test-prj-123-env-123-resources' }],
      publishedPorts: [],
    });
    mocks.runDockerContainerToCompletion.mockResolvedValue({
      containerId: 'operation_container_123',
      logs: [],
      stderr: '',
      stdout: 'ok',
    });

    try {
      await expect(
        runRuntimeResourceRestoreOperation(
          createResourceOperationRequest({
            backupId: backupArtifact.backupId,
            readiness: { port: 5432, timeoutMs: 0, type: 'tcp' },
          }),
          createRuntimeConfig({ resourceBackupDirectory: backupArtifact.root }),
        ),
      ).resolves.toEqual({
        stderr: '',
        stdout: 'ok',
      });
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(mocks.canConnectToRuntimeHost).toHaveBeenCalledTimes(1);
    expect(mocks.canConnectToRuntimeHost.mock.calls[0]?.slice(0, 2)).toEqual(['127.0.0.1', 5432]);
  });

  it('probes restore readiness through the resource container network address', async (): Promise<void> => {
    const resourceNetworkAddress: string = ['172', '20', '0', '15'].join('.');
    const backupArtifact: RuntimeResourceBackupArtifactFixture = await createResourceBackupArtifactFixture();

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

    let failure: Error | undefined;
    try {
      await runRuntimeResourceRestoreOperation(
        createResourceOperationRequest({
          backupId: backupArtifact.backupId,
          readiness: { port: 5432, timeoutMs: 1, type: 'tcp' },
        }),
        createRuntimeConfig({ resourceBackupDirectory: backupArtifact.root }),
      );
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toBeInstanceOf(Error);
    if (!isNodeRuntimeError(failure)) {
      throw new Error('Expected runtime resource readiness failure.');
    }
    expect(failure.code).toBe(nodeRuntimeResourceReadinessFailedErrorCode);
    expect(failure.message).toBe('Resource postgres did not become ready after restore before 1ms.');

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
    expect(operationContainerInput?.command).toEqual(['pg_dump > "$COMPARTMENT_BACKUP_DIR/dump.sql"']);
    expect(operationContainerInput?.entrypoint).toEqual(['sh', '-lc']);
    expect(operationContainerInput?.labels).toEqual(
      expect.objectContaining({
        'compartment.environmentId': 'env_123',
        'compartment.namespace': 'test',
        'compartment.projectId': 'prj_123',
        'compartment.resource': 'postgres',
      }),
    );
    expect(operationContainerInput?.mounts).toEqual([
      {
        containerPath: '/backup',
        hostPath: backupArtifact.path,
        readOnly: true,
      },
    ]);
  });

  it('rejects operation containers before joining an unowned resource network', async (): Promise<void> => {
    const backupArtifact: RuntimeResourceBackupArtifactFixture = await createResourceBackupArtifactFixture();

    mocks.ensureDockerNetwork.mockRejectedValueOnce(
      new Error(
        'Docker network compartment-test-prj-123-env-123-resources exists without required label compartment.namespace=test.',
      ),
    );

    await expect(
      runRuntimeResourceRestoreOperation(
        createResourceOperationRequest({
          backupId: backupArtifact.backupId,
          readiness: null,
        }),
        createRuntimeConfig({ resourceBackupDirectory: backupArtifact.root }),
      ),
    ).rejects.toThrow(
      'Docker network compartment-test-prj-123-env-123-resources exists without required label compartment.namespace=test.',
    );
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });
});

describe('runRuntimeResourceBackupOperation', (): void => {
  it('mounts backup artifact directories by id with writable access', async (): Promise<void> => {
    const backupArtifact: RuntimeResourceBackupArtifactFixture = await createResourceBackupArtifactFixture();
    mocks.runDockerContainerToCompletion.mockResolvedValue({
      containerId: 'operation_container_123',
      logs: [],
      stderr: '',
      stdout: 'ok',
    });

    await expect(
      runRuntimeResourceBackupOperation(
        createResourceOperationRequest({ backupId: backupArtifact.backupId }),
        createRuntimeConfig({ resourceBackupDirectory: backupArtifact.root }),
      ),
    ).resolves.toEqual({
      stderr: '',
      stdout: 'ok',
    });

    const operationContainerInput: DockerRunContainerInput | undefined =
      mocks.runDockerContainerToCompletion.mock.calls[0]?.[0];
    expect(operationContainerInput?.securityProfile).toMatchObject({
      name: 'restricted-writable',
      user: '10001:10001',
    });
    expect(operationContainerInput?.mounts).toEqual([
      {
        containerPath: '/backup',
        hostPath: backupArtifact.path,
      },
    ]);
  });

  it('revalidates backup artifact directories after Docker setup and before container create', async (): Promise<void> => {
    const backupArtifact: RuntimeResourceBackupArtifactFixture = await createResourceBackupArtifactFixture();
    const outsideDirectory: string = await createResourceBackupRoot();
    mocks.ensureDockerNetwork.mockImplementationOnce(async (): Promise<void> => {
      await rm(backupArtifact.path, { force: true, recursive: true });
      await symlink(outsideDirectory, backupArtifact.path);
    });

    await expect(
      runRuntimeResourceBackupOperation(
        createResourceOperationRequest({ backupId: backupArtifact.backupId }),
        createRuntimeConfig({ resourceBackupDirectory: backupArtifact.root }),
      ),
    ).rejects.toThrow('Resource backup artifact directory "rbak_123" must not include symlinks.');

    expect(mocks.ensureDockerImageAvailable).toHaveBeenCalledTimes(1);
    expect(mocks.ensureDockerNetwork).toHaveBeenCalledTimes(1);
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it.each(['../etc', '/etc', 'rbak/123', 'rbak\\123', ''])(
    'rejects unsafe backup id "%s" before Docker side effects',
    async (backupId: string): Promise<void> => {
      const resourceBackupDirectory: string = await createResourceBackupRoot();

      await expect(
        runRuntimeResourceBackupOperation(
          createResourceOperationRequest({ backupId }),
          createRuntimeConfig({ resourceBackupDirectory }),
        ),
      ).rejects.toThrow();

      expect(mocks.ensureDockerImageAvailable).not.toHaveBeenCalled();
      expect(mocks.ensureDockerNetwork).not.toHaveBeenCalled();
      expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
    },
  );

  it('rejects missing backup artifact directories before Docker side effects', async (): Promise<void> => {
    const resourceBackupDirectory: string = await createResourceBackupRoot();

    await expect(
      runRuntimeResourceBackupOperation(
        createResourceOperationRequest({ backupId: 'rbak_missing' }),
        createRuntimeConfig({ resourceBackupDirectory }),
      ),
    ).rejects.toThrow('Resource backup artifact directory "rbak_missing" does not exist.');

    expect(mocks.ensureDockerImageAvailable).not.toHaveBeenCalled();
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it('rejects non-directory backup artifacts before Docker side effects', async (): Promise<void> => {
    const resourceBackupDirectory: string = await createResourceBackupRoot();
    await writeFile(join(resourceBackupDirectory, 'rbak_file'), '');

    await expect(
      runRuntimeResourceBackupOperation(
        createResourceOperationRequest({ backupId: 'rbak_file' }),
        createRuntimeConfig({ resourceBackupDirectory }),
      ),
    ).rejects.toThrow('Resource backup artifact directory "rbak_file" must point to a directory.');

    expect(mocks.ensureDockerImageAvailable).not.toHaveBeenCalled();
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it('rejects non-directory backup roots before Docker side effects', async (): Promise<void> => {
    const parentDirectory: string = await createResourceBackupRoot();
    const resourceBackupDirectory: string = join(parentDirectory, 'resource-backups-file');
    await writeFile(resourceBackupDirectory, '');

    await expect(
      runRuntimeResourceBackupOperation(
        createResourceOperationRequest({ backupId: 'rbak_123' }),
        createRuntimeConfig({ resourceBackupDirectory }),
      ),
    ).rejects.toThrow('Resource backup root directory "." must point to a directory.');

    expect(mocks.ensureDockerImageAvailable).not.toHaveBeenCalled();
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it('rejects symlinked backup roots before Docker side effects', async (): Promise<void> => {
    const parentDirectory: string = await createResourceBackupRoot();
    const realBackupRoot: string = await createResourceBackupRoot();
    const resourceBackupDirectory: string = join(parentDirectory, 'resource-backups-link');
    await symlink(realBackupRoot, resourceBackupDirectory);

    await expect(
      runRuntimeResourceBackupOperation(
        createResourceOperationRequest({ backupId: 'rbak_123' }),
        createRuntimeConfig({ resourceBackupDirectory }),
      ),
    ).rejects.toThrow('Resource backup root directory "." must not include symlinks.');

    expect(mocks.ensureDockerImageAvailable).not.toHaveBeenCalled();
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });

  it('rejects symlinked backup artifact directories before Docker side effects', async (): Promise<void> => {
    const resourceBackupDirectory: string = await createResourceBackupRoot();
    const outsideDirectory: string = await createResourceBackupRoot();
    await symlink(outsideDirectory, join(resourceBackupDirectory, 'rbak_link'));

    await expect(
      runRuntimeResourceBackupOperation(
        createResourceOperationRequest({ backupId: 'rbak_link' }),
        createRuntimeConfig({ resourceBackupDirectory }),
      ),
    ).rejects.toThrow('Resource backup artifact directory "rbak_link" must not include symlinks.');

    expect(mocks.ensureDockerImageAvailable).not.toHaveBeenCalled();
    expect(mocks.runDockerContainerToCompletion).not.toHaveBeenCalled();
  });
});

interface RuntimeResourceBackupArtifactFixture {
  backupId: string;
  path: string;
  root: string;
}

async function createResourceBackupArtifactFixture(
  backupId: string = 'rbak_123',
): Promise<RuntimeResourceBackupArtifactFixture> {
  const root: string = await createResourceBackupRoot();
  const path: string = join(root, backupId);
  await mkdir(path);

  return {
    backupId,
    path,
    root,
  };
}

async function createResourceBackupRoot(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-node-resource-backups-'));
  temporaryDirectories.push(directory);

  return directory;
}

function createResourceOperationRequest(
  overrides: Partial<NodeResourceOperationRequest> = {},
): NodeResourceOperationRequest {
  return {
    backupId: 'rbak_123',
    definition: {
      command: 'pg_dump > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
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
    ...overrides,
  };
}

function createRuntimeConfig(overrides: Partial<RuntimeResourceOperationConfig> = {}): RuntimeResourceOperationConfig {
  return {
    appPortEnd: 39_000,
    appPortStart: 38_000,
    dockerNamespace: 'test',
    resourceBackupDirectory: '/var/lib/compartment/resource-backups',
    runtimeConnectivityMode: 'network',
    runtimeDefaultUpstreamHost: 'host.docker.internal',
    runtimeGid: 10001,
    runtimeUid: 10001,
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    ...overrides,
  };
}
