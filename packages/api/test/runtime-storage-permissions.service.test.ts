import type { Stats } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import type { ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import {
  prepareResourceBackupArtifactDirectory,
  summarizeResourceBackupArtifact,
} from '../src/services/resource-backup-artifact.service';
import {
  copySourceUploadArchiveFromPath,
  readSourceUploadArchive,
  resolveSourceUploadArchivePath,
  storeSourceUploadArchive,
} from '../src/services/source-upload-storage.service';
import {
  resolveSourceResolutionTaskArchivePath,
  storeSourceResolutionTaskArchive,
} from '../src/services/git-source/source-resolution-task-archive-storage.service';
import {
  chmodPrivateRuntimeStorageFile,
  repairPrivateRuntimeStoragePermissions,
} from '../src/services/private-runtime-storage-permissions.service';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const privateDirectoryMode: number = 0o700;
const privateFileMode: number = 0o600;
let cleanupDirectories: string[] = [];

describe('runtime storage permissions', (): void => {
  afterEach(async (): Promise<void> => {
    clearApiRuntime();
    await Promise.all(cleanupDirectories.map(removeDirectory));
    cleanupDirectories = [];
  });

  it('stores source archive files with owner-only permissions', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const config: ApiConfig = createRuntimeStorageApiConfig(runtimeRoot);
    await mkdir(config.sourceArchiveDirectory, { recursive: true });
    configureApiRuntime({ config, db: createMockDatabase() });

    await storeSourceUploadArchive('sup_mode', Readable.from([Buffer.from('source archive')]));
    const copiedSourcePath: string = join(runtimeRoot, 'source.tgz');
    await writeFile(copiedSourcePath, 'copied source', { mode: 0o644 });
    await copySourceUploadArchiveFromPath('sup_copy', copiedSourcePath);
    await storeSourceResolutionTaskArchive('task_mode', Buffer.from('resolved source'));

    await expect(readPermissionBits(resolveSourceUploadArchivePath('sup_mode'))).resolves.toBe(privateFileMode);
    await expect(readPermissionBits(resolveSourceUploadArchivePath('sup_copy'))).resolves.toBe(privateFileMode);
    await expect(readPermissionBits(resolveSourceResolutionTaskArchivePath('task_mode'))).resolves.toBe(
      privateFileMode,
    );
  });

  it('repairs resource backup artifact permissions before summarizing backup output', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const config: ApiConfig = createRuntimeStorageApiConfig(runtimeRoot);
    await mkdir(config.resourceBackupDirectory, { recursive: true });
    configureApiRuntime({ config, db: createMockDatabase() });

    const artifactDirectory: string = await prepareResourceBackupArtifactDirectory('rbak_mode');
    const nestedDirectory: string = join(artifactDirectory, 'nested');
    const backupFile: string = join(nestedDirectory, 'dump.sql');
    await mkdir(nestedDirectory, { mode: 0o755 });
    await writeFile(backupFile, 'backup', { mode: 0o644 });
    await chmod(nestedDirectory, 0o755);
    await chmod(backupFile, 0o644);

    await summarizeResourceBackupArtifact('rbak_mode');

    await expect(readPermissionBits(artifactDirectory)).resolves.toBe(privateDirectoryMode);
    await expect(readPermissionBits(nestedDirectory)).resolves.toBe(privateDirectoryMode);
    await expect(readPermissionBits(backupFile)).resolves.toBe(privateFileMode);
  });

  it('does not chmod symlink targets while repairing runtime storage', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const storageDirectory: string = join(runtimeRoot, 'source-archives');
    const outsideFile: string = join(runtimeRoot, 'outside.tgz');
    const linkPath: string = join(storageDirectory, 'linked.tgz');
    await mkdir(storageDirectory, { recursive: true });
    await writeFile(outsideFile, 'outside', { mode: 0o644 });
    await symlink(outsideFile, linkPath);

    await repairPrivateRuntimeStoragePermissions(storageDirectory);
    await expect(chmodPrivateRuntimeStorageFile(linkPath)).rejects.toThrow();

    await expect(readPermissionBits(outsideFile)).resolves.toBe(0o644);
  });

  it('repairs unreadable runtime storage directories before traversing them', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const storageDirectory: string = join(runtimeRoot, 'resource-backups');
    const nestedDirectory: string = join(storageDirectory, 'rbak_locked');
    const backupFile: string = join(nestedDirectory, 'dump.sql');
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(backupFile, 'backup', { mode: 0o644 });
    await chmod(backupFile, 0o644);
    await chmod(nestedDirectory, 0o000);

    try {
      await repairPrivateRuntimeStoragePermissions(storageDirectory);

      await expect(readPermissionBits(nestedDirectory)).resolves.toBe(privateDirectoryMode);
      await expect(readPermissionBits(backupFile)).resolves.toBe(privateFileMode);
    } finally {
      await chmod(nestedDirectory, privateDirectoryMode).catch((): void => undefined);
    }
  });

  it('rejects symlinked resource backup artifact directories', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const config: ApiConfig = createRuntimeStorageApiConfig(runtimeRoot);
    const outsideDirectory: string = join(runtimeRoot, 'outside-backup-target');
    await mkdir(config.resourceBackupDirectory, { recursive: true });
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, join(config.resourceBackupDirectory, 'rbak_link'));
    configureApiRuntime({ config, db: createMockDatabase() });

    await expect(prepareResourceBackupArtifactDirectory('rbak_link')).rejects.toThrow('must not include symlinks');
    await expect(summarizeResourceBackupArtifact('rbak_link')).rejects.toThrow('must not include symlinks');
  });

  it('rejects symlinked source upload archive reads', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const config: ApiConfig = createRuntimeStorageApiConfig(runtimeRoot);
    const outsideArchivePath: string = join(runtimeRoot, 'outside-secret.tgz');
    await mkdir(config.sourceArchiveDirectory, { recursive: true });
    configureApiRuntime({ config, db: createMockDatabase() });
    await writeFile(outsideArchivePath, 'outside archive');
    await symlink(outsideArchivePath, resolveSourceUploadArchivePath('sup_linked'));

    await expect(readSourceUploadArchive('sup_linked')).rejects.toThrow('must not include symlinks');
  });

  it('does not publish source upload archives over existing symlink paths', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const config: ApiConfig = createRuntimeStorageApiConfig(runtimeRoot);
    const outsideArchivePath: string = join(runtimeRoot, 'outside-secret.tgz');
    await mkdir(config.sourceArchiveDirectory, { recursive: true });
    configureApiRuntime({ config, db: createMockDatabase() });
    await writeFile(outsideArchivePath, 'outside archive');
    await symlink(outsideArchivePath, resolveSourceUploadArchivePath('sup_linked'));

    await expect(
      storeSourceUploadArchive('sup_linked', Readable.from([Buffer.from('source archive')])),
    ).rejects.toThrow();

    await expect(readFile(outsideArchivePath, 'utf8')).resolves.toBe('outside archive');
  });

  it('does not copy source upload archives over existing symlink paths', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const config: ApiConfig = createRuntimeStorageApiConfig(runtimeRoot);
    const copiedSourcePath: string = join(runtimeRoot, 'copied-source.tgz');
    const outsideArchivePath: string = join(runtimeRoot, 'outside-secret.tgz');
    await mkdir(config.sourceArchiveDirectory, { recursive: true });
    configureApiRuntime({ config, db: createMockDatabase() });
    await writeFile(copiedSourcePath, 'copied source');
    await writeFile(outsideArchivePath, 'outside archive');
    await symlink(outsideArchivePath, resolveSourceUploadArchivePath('sup_copy_linked'));

    await expect(copySourceUploadArchiveFromPath('sup_copy_linked', copiedSourcePath)).rejects.toThrow(
      'must not include symlinks',
    );

    await expect(readFile(outsideArchivePath, 'utf8')).resolves.toBe('outside archive');
  });

  it('repairs existing source archive and resource backup storage on app startup', async (): Promise<void> => {
    const runtimeRoot: string = await createTemporaryDirectory();
    const config: ApiConfig = createRuntimeStorageApiConfig(runtimeRoot);
    const sourceFile: string = join(config.sourceArchiveDirectory, 'loose.tgz');
    const backupNestedDirectory: string = join(config.resourceBackupDirectory, 'rbak_existing');
    const backupFile: string = join(backupNestedDirectory, 'dump.sql');
    await mkdir(config.sourceArchiveDirectory, { mode: 0o755, recursive: true });
    await mkdir(backupNestedDirectory, { mode: 0o755, recursive: true });
    await writeFile(sourceFile, 'source', { mode: 0o644 });
    await writeFile(backupFile, 'backup', { mode: 0o644 });
    await chmod(config.sourceArchiveDirectory, 0o755);
    await chmod(config.resourceBackupDirectory, 0o755);
    await chmod(backupNestedDirectory, 0o755);
    await chmod(sourceFile, 0o644);
    await chmod(backupFile, 0o644);

    const app: ApiApp = createApp({
      closePool: false,
      config,
      db: createMockDatabase(),
      pool: createMockPool(),
    });
    await app.ready();
    await app.close();

    await expect(readPermissionBits(config.sourceArchiveDirectory)).resolves.toBe(privateDirectoryMode);
    await expect(readPermissionBits(config.resourceBackupDirectory)).resolves.toBe(privateDirectoryMode);
    await expect(readPermissionBits(backupNestedDirectory)).resolves.toBe(privateDirectoryMode);
    await expect(readPermissionBits(sourceFile)).resolves.toBe(privateFileMode);
    await expect(readPermissionBits(backupFile)).resolves.toBe(privateFileMode);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-runtime-storage-permissions-'));
  cleanupDirectories.push(directory);
  return directory;
}

async function removeDirectory(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}

async function readPermissionBits(path: string): Promise<number> {
  const stats: Stats = await stat(path);
  return stats.mode & 0o777;
}

function createMockDatabase(): Database {
  return {} as Database;
}

function createMockPool(): Pool {
  return {} as Pool;
}

function createRuntimeStorageApiConfig(runtimeRoot: string): ApiConfig {
  return {
    auditFileSink: {
      ...defaultAuditFileSinkConfig,
      directory: join(runtimeRoot, 'audit'),
      enabled: false,
    },
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditRetentionDays: 90,
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'internal',
    controlPlaneHost: 'console.localhost',
    customTlsDirectory: join(runtimeRoot, 'tls'),
    databaseUrl: 'postgres://compartment:compartment@127.0.0.1:5432/compartment',
    edgeToken: 'test-edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    managedDomainBrokerToken: null,
    managedDomainBrokerUrl: null,
    nodeAgentSocketPath: '/tmp/compartment/api-test/node/runtime-storage.sock',
    port: 9443,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    resourceBackupDirectory: join(runtimeRoot, 'resource-backups'),
    rollbackRetentionLimit: null,
    runtimeControlToken: 'test-runtime-control-token',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    sessionSecret: 'test-secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: join(runtimeRoot, 'source-archives'),
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/compartment/runtime-storage/system-api.sock',
    systemToken: 'test-system-token',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: [],
    variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  };
}
