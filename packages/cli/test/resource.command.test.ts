import type {
  ResourceBackupSummary,
  ResourceDeleteResponse,
  ResourceRestoreAsResponse,
  ResourceRestoreResponse,
  ResourceSummary,
} from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { ResourceDeleteInput, ResourceRestoreInput } from '../src/services/resources.service.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  createCliCapture,
  type CliCommandCapture,
  type CliCommandResult,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
} from './cli-test.harness';

type DeleteResourceCommand = (
  context: AuthenticatedContext,
  input: ResourceDeleteInput,
) => Promise<ResourceDeleteResponse>;
type RestoreResourceBackupAsResponse = ResourceRestoreResponse | ResourceRestoreAsResponse;
type RestoreResourceBackupCommand = (
  context: AuthenticatedContext,
  input: ResourceRestoreInput,
) => Promise<RestoreResourceBackupAsResponse>;
type UnusedResourceService = () => Promise<never>;
type ReadCliConfig = () => Promise<CliConfig>;

type DeleteResourceMock = Mock<DeleteResourceCommand>;
type RestoreResourceBackupMock = Mock<RestoreResourceBackupCommand>;
type UnusedResourceServiceMock = Mock<UnusedResourceService>;

interface ResourceCommandMocks {
  deleteResourceMock: DeleteResourceMock;
  restoreResourceBackupMock: RestoreResourceBackupMock;
}

interface ResourceServiceModule {
  bootstrapResource: UnusedResourceServiceMock;
  createResourceBackup: UnusedResourceServiceMock;
  deleteResource: DeleteResourceMock;
  inspectResource: UnusedResourceServiceMock;
  listResourceBackups: UnusedResourceServiceMock;
  listResourceOutputs: UnusedResourceServiceMock;
  listResources: UnusedResourceServiceMock;
  readResourceLogs: UnusedResourceServiceMock;
  restoreResourceBackup: RestoreResourceBackupMock;
  showResourceBackup: UnusedResourceServiceMock;
  showResourceOutput: UnusedResourceServiceMock;
  startResource: UnusedResourceServiceMock;
  stopResource: UnusedResourceServiceMock;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

describe.sequential('compartment resource commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
    restoreCliCommandModules(['../src/services/resources.service', '../src/store/config.store']);
  });

  it('does not expose restore as a sibling resource command', async (): Promise<void> => {
    const mocks: ResourceCommandMocks = mockResourceCommandModules(createResourceRestoreResponse());

    const result: CliCommandResult = await runCliCommand([
      'resource',
      'restore',
      '--resource',
      'postgres',
      '--backup',
      'rbak_123',
      '--yes',
    ]);

    expectCliFailure(result, "unknown command 'restore'");
    expect(mocks.restoreResourceBackupMock).not.toHaveBeenCalled();
  });

  it('rejects restore target ambiguity when --resource and --as are combined', async (): Promise<void> => {
    const mocks: ResourceCommandMocks = mockResourceCommandModules(createResourceRestoreResponse());

    const result: CliCommandResult = await runCliCommand([
      'resource',
      'backup',
      'restore',
      '--resource',
      'postgres',
      '--backup',
      'rbak_123',
      '--as',
      'db-restore',
    ]);

    expectCliFailure(result, 'Resource backup restore cannot use --resource with --as.');
    expect(mocks.restoreResourceBackupMock).not.toHaveBeenCalled();
  });

  it('rejects non-interactive resource data deletes without explicit confirmation', async (): Promise<void> => {
    const mocks: ResourceCommandMocks = mockResourceCommandModules();

    const result: CliCommandResult = await runCliCommand([
      'resource',
      'delete',
      '--resource',
      'postgres',
      '--delete-data',
    ]);

    expectCliFailure(result, 'Resource data delete requires interactive confirmation.');
    expect(mocks.deleteResourceMock).not.toHaveBeenCalled();
  });

  it('runs non-interactive resource data deletes when confirmation is explicit', async (): Promise<void> => {
    const mocks: ResourceCommandMocks = mockResourceCommandModules();

    const result: CliCommandResult = await runCliCommand([
      'resource',
      'delete',
      '--resource',
      'postgres',
      '--delete-data',
      '--yes',
    ]);

    expectCliSuccess(result);
    expect(readCliStderr(result.capture)).not.toContain('Are you sure?');
    expect(mocks.deleteResourceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deleteData: true,
        resourceName: 'postgres',
      }),
    );
  });

  it('cancels resource data deletes when the interactive prompt is rejected', async (): Promise<void> => {
    const mocks: ResourceCommandMocks = mockResourceCommandModules();
    const capture: CliCommandCapture = createInteractiveCliCapture();
    capture.stdin.end('n\n');

    const result: CliCommandResult = await runCliCommand(
      ['resource', 'delete', '--resource', 'postgres', '--delete-data'],
      capture,
    );

    expectCliFailure(result, 'Resource data delete cancelled.');
    expect(readCliStderr(result.capture)).toContain('Delete data volumes for resource postgres. Are you sure? [y/N]:');
    expect(mocks.deleteResourceMock).not.toHaveBeenCalled();
  });
});

function createInteractiveCliCapture(): CliCommandCapture {
  const capture: CliCommandCapture = createCliCapture({ isTTY: true });
  Object.assign(capture.stdin, { setRawMode: vi.fn() });
  return capture;
}

function mockResourceCommandModules(
  response: RestoreResourceBackupAsResponse = createResourceRestoreResponse(),
): ResourceCommandMocks {
  const deleteResourceMock: DeleteResourceMock = vi.fn<DeleteResourceCommand>().mockResolvedValue({
    retainedVolumes: [],
    success: true,
  });
  const restoreResourceBackupMock: RestoreResourceBackupMock = vi
    .fn<RestoreResourceBackupCommand>()
    .mockResolvedValue(response);
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());

  vi.doMock(
    '../src/services/resources.service',
    (): ResourceServiceModule => ({
      bootstrapResource: createUnusedResourceServiceMock(),
      createResourceBackup: createUnusedResourceServiceMock(),
      deleteResource: deleteResourceMock,
      inspectResource: createUnusedResourceServiceMock(),
      listResourceBackups: createUnusedResourceServiceMock(),
      listResourceOutputs: createUnusedResourceServiceMock(),
      listResources: createUnusedResourceServiceMock(),
      readResourceLogs: createUnusedResourceServiceMock(),
      restoreResourceBackup: restoreResourceBackupMock,
      showResourceBackup: createUnusedResourceServiceMock(),
      showResourceOutput: createUnusedResourceServiceMock(),
      startResource: createUnusedResourceServiceMock(),
      stopResource: createUnusedResourceServiceMock(),
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
    }),
  );

  return {
    deleteResourceMock,
    restoreResourceBackupMock,
  };
}

function createUnusedResourceServiceMock(): UnusedResourceServiceMock {
  return vi.fn<UnusedResourceService>();
}

function createResourceRestoreResponse(): ResourceRestoreResponse {
  const resource: ResourceSummary = createResourceSummary();
  const restoredBackup: ResourceBackupSummary = {
    artifactLocation: '/tmp/backups/rbak_123',
    checksum: 'sha256:abc123',
    completedAt: '2026-05-06T12:05:00.000Z',
    createdAt: '2026-05-06T12:00:00.000Z',
    failureSummary: null,
    id: 'rbak_123',
    purpose: 'manual',
    retentionDeletedAt: null,
    retentionReason: null,
    resource,
    size: 128,
    status: 'succeeded',
  };
  const preRestoreBackup: ResourceBackupSummary = {
    ...restoredBackup,
    id: 'rbak_pre',
    purpose: 'pre_restore',
  };

  return {
    environment: {
      createdAt: '2026-05-06T12:00:00.000Z',
      id: 'env_123',
      name: 'staging',
      projectId: 'prj_123',
      updatedAt: '2026-05-06T12:00:00.000Z',
    },
    preRestoreBackup,
    project: {
      archivedAt: null,
      createdAt: '2026-05-06T12:00:00.000Z',
      id: 'prj_123',
      name: 'internal-tools',
      organizationId: 'org_123',
      updatedAt: '2026-05-06T12:00:00.000Z',
    },
    resource,
    restoredBackup,
    success: true,
  };
}

function createResourceSummary(): ResourceSummary {
  return {
    createdAt: '2026-05-06T12:00:00.000Z',
    env: [],
    id: 'res_123',
    image: 'postgres:16',
    name: 'postgres',
    ports: [5432],
    readiness: {
      port: 5432,
      timeoutMs: 30000,
      type: 'tcp',
    },
    status: 'running',
    updatedAt: '2026-05-06T12:00:00.000Z',
    volumes: [{ mountPath: '/var/lib/postgresql/data', name: 'postgres-data' }],
  };
}
