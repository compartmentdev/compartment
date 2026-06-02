import { createServer, type Server } from 'node:net';
import type { Stats } from 'node:fs';
import { lstat, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileModePermissions } from '@compartment/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertValidSystemApiSocketPath,
  prepareSystemApiSocketPath,
  restrictSystemApiSocketPathPermissions,
} from '../src/system-api-socket-path';

const temporaryDirectories: string[] = [];

describe('system API socket path helpers', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directoryPath: string): Promise<void> => {
        await rm(directoryPath, { force: true, recursive: true });
      }),
    );
  });

  it('accepts a socket path inside a private subdirectory', (): void => {
    expect((): void => {
      assertValidSystemApiSocketPath(join(tmpdir(), 'compartment-test', 'api', 'system-api.sock'));
    }).not.toThrow();
  });

  it('rejects a socket path directly under the active temp root', (): void => {
    expect((): void => {
      assertValidSystemApiSocketPath(join(tmpdir(), 'system-api.sock'));
    }).toThrow(
      'COMPARTMENT_SYSTEM_API_SOCKET must point to a socket inside a private subdirectory like /tmp/compartment/dev/api/system-api.sock or /var/run/compartment/api/system-api.sock.',
    );
  });

  it('rejects relative socket paths', (): void => {
    expect((): void => {
      assertValidSystemApiSocketPath(join('tmp', 'compartment', 'api', 'system-api.sock'));
    }).toThrow('COMPARTMENT_SYSTEM_API_SOCKET must be an absolute socket path.');
  });

  it('rejects a socket path directly under the shared Compartment runtime root', (): void => {
    expect((): void => {
      assertValidSystemApiSocketPath(join(tmpdir(), 'compartment', 'system-api.sock'));
    }).toThrow(
      'COMPARTMENT_SYSTEM_API_SOCKET must point to a socket inside a private subdirectory like /tmp/compartment/dev/api/system-api.sock or /var/run/compartment/api/system-api.sock.',
    );
  });

  it('refuses to replace an existing non-socket path', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const socketPath: string = join(rootDirectoryPath, 'run', 'system-api.sock');
    await mkdir(dirname(socketPath), { recursive: true });
    await writeFile(socketPath, 'not-a-socket');

    expect((): void => {
      prepareSystemApiSocketPath(socketPath);
    }).toThrow(`Refusing to replace non-socket path at ${socketPath}.`);
  });

  it('accepts a missing socket path and prepares its directory', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const socketPath: string = join(rootDirectoryPath, 'run', 'system-api.sock');

    expect((): void => {
      prepareSystemApiSocketPath(socketPath);
    }).not.toThrow();

    const socketDirectoryStats: Stats = await lstat(dirname(socketPath));
    expect(socketDirectoryStats.isDirectory()).toBe(true);
    expect(readFileModePermissions(socketDirectoryStats.mode)).toBe(0o700);
  });

  it('refuses symlink parent directories before creating the socket directory', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const realDirectoryPath: string = join(rootDirectoryPath, 'real-run');
    const symlinkDirectoryPath: string = join(rootDirectoryPath, 'run');
    const socketPath: string = join(symlinkDirectoryPath, 'api', 'system-api.sock');
    await mkdir(realDirectoryPath, { recursive: true });
    await symlink(realDirectoryPath, symlinkDirectoryPath, 'dir');

    expect((): void => {
      prepareSystemApiSocketPath(socketPath);
    }).toThrow(`System API socket directory ${symlinkDirectoryPath} must be a real directory.`);
  });

  it('restricts the bound socket to owner-only access', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const socketPath: string = join(rootDirectoryPath, 'run', 'api', 'system-api.sock');
    const server: Server = createServer();

    prepareSystemApiSocketPath(socketPath);
    await listenOnSocket(server, socketPath);
    try {
      restrictSystemApiSocketPathPermissions(socketPath);

      const socketStats: Stats = await stat(socketPath);
      expect(readFileModePermissions(socketStats.mode)).toBe(0o600);
    } finally {
      await closeServer(server);
    }
  });
});

async function createTemporarySocketRootDirectory(): Promise<string> {
  return await mkdtemp(join('/tmp', 'compartment-system-api-path-'));
}

async function listenOnSocket(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
    server.once('error', reject);
    server.listen(socketPath, (): void => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}
