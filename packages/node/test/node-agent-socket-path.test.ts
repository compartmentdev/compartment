import { createServer, type Server } from 'node:net';
import type { Stats } from 'node:fs';
import { lstat, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareNodeAgentSocketPath, restrictNodeAgentSocketPathPermissions } from '../src/node-agent-socket-path';

const temporaryDirectories: string[] = [];
const runtimeGid: number = 10001;

describe('node agent socket path helpers', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directoryPath: string): Promise<void> => {
        await rm(directoryPath, { force: true, recursive: true });
      }),
    );
  });

  it('accepts a socket path inside a scoped private runtime directory', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const socketPath: string = join(rootDirectoryPath, 'node', 'agent.sock');

    expect((): void => {
      prepareNodeAgentSocketPath(socketPath, runtimeGid);
    }).not.toThrow();
  });

  it('rejects a socket path directly under a shared runtime root', (): void => {
    expect((): void => {
      prepareNodeAgentSocketPath(join(tmpdir(), 'compartment', 'agent.sock'), runtimeGid);
    }).toThrow(
      'COMPARTMENT_NODE_AGENT_SOCKET must point to a socket inside a private subdirectory like /tmp/compartment/dev/node/agent.sock or /var/run/compartment/node/agent.sock.',
    );
  });

  it('rejects relative socket paths', (): void => {
    expect((): void => {
      prepareNodeAgentSocketPath(join('tmp', 'compartment', 'node', 'agent.sock'), runtimeGid);
    }).toThrow('COMPARTMENT_NODE_AGENT_SOCKET must be an absolute socket path.');
  });

  it('refuses to replace an existing non-socket path', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const socketPath: string = join(rootDirectoryPath, 'run', 'node', 'agent.sock');
    await mkdir(dirname(socketPath), { recursive: true });
    await writeFile(socketPath, 'not-a-socket');

    expect((): void => {
      prepareNodeAgentSocketPath(socketPath, runtimeGid);
    }).toThrow(`Refusing to replace non-socket path at ${socketPath}.`);
  });

  it('prepares the socket directory with private permissions', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const socketPath: string = join(rootDirectoryPath, 'run', 'node', 'agent.sock');

    prepareNodeAgentSocketPath(socketPath, runtimeGid);

    const socketDirectoryStats: Stats = await lstat(dirname(socketPath));
    expect(socketDirectoryStats.isDirectory()).toBe(true);
    expect(socketDirectoryStats.mode & 0o777).toBe(0o750);
  });

  it('refuses symlink parent directories before creating the socket directory', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const realDirectoryPath: string = join(rootDirectoryPath, 'real-run');
    const symlinkDirectoryPath: string = join(rootDirectoryPath, 'run');
    const socketPath: string = join(symlinkDirectoryPath, 'node', 'agent.sock');
    await mkdir(realDirectoryPath, { recursive: true });
    await symlink(realDirectoryPath, symlinkDirectoryPath, 'dir');

    expect((): void => {
      prepareNodeAgentSocketPath(socketPath, runtimeGid);
    }).toThrow(`Node agent socket directory ${symlinkDirectoryPath} must be a real directory.`);
  });

  it('restricts the bound socket to owner-only access', async (): Promise<void> => {
    const rootDirectoryPath: string = await createTemporarySocketRootDirectory();
    temporaryDirectories.push(rootDirectoryPath);
    const socketPath: string = join(rootDirectoryPath, 'run', 'node', 'agent.sock');
    const server: Server = createServer();

    prepareNodeAgentSocketPath(socketPath, runtimeGid);
    await listenOnSocket(server, socketPath);
    try {
      restrictNodeAgentSocketPathPermissions(socketPath, runtimeGid);

      const socketStats: Stats = await stat(socketPath);
      expect(socketStats.mode & 0o777).toBe(0o660);
    } finally {
      await closeServer(server);
    }
  });
});

async function createTemporarySocketRootDirectory(): Promise<string> {
  return await mkdtemp(join('/tmp', 'compartment-node-agent-path-'));
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
