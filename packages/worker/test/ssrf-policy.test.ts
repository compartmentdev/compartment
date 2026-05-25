import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import {
  downloadGitHubRepositoryArchive,
  readGitHubBranchHeadSha,
} from '../src/services/worker-git-source-github.service';

interface LocalTcpServerHandle {
  close: () => Promise<void>;
  connectionCount: () => number;
  trustedHost: string;
}

interface ErrorWithCause extends Error {
  cause?: Error | undefined;
}

describe('worker SSRF policy', (): void => {
  it('blocks GitHub Enterprise provider hosts that resolve to loopback before opening a socket', async (): Promise<void> => {
    const server: LocalTcpServerHandle = await startLocalTcpServer();

    try {
      await withTrustedOutboundHostsEnv(server.trustedHost, async (): Promise<void> => {
        await expectRejectedErrorChainToContain(async (): Promise<void> => {
          await readGitHubBranchHeadSha({
            ...createSyncTask(),
            providerHost: server.trustedHost,
          });
        }, 'unsafe address');
      });

      expect(server.connectionCount()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('blocks GitHub archive downloads when the provider host resolves to loopback', async (): Promise<void> => {
    const server: LocalTcpServerHandle = await startLocalTcpServer();

    try {
      await withTrustedOutboundHostsEnv(server.trustedHost, async (): Promise<void> => {
        await expectRejectedErrorChainToContain(async (): Promise<void> => {
          await downloadGitHubRepositoryArchive(
            {
              ...createResolutionTask(),
              providerHost: server.trustedHost,
            },
            'resolved-commit-sha',
            '/tmp/compartment-unreachable-archive.tgz',
          );
        }, 'unsafe address');
      });

      expect(server.connectionCount()).toBe(0);
    } finally {
      await server.close();
    }
  });
});

async function startLocalTcpServer(): Promise<LocalTcpServerHandle> {
  let connectionCount: number = 0;
  const server: Server = createServer((socket: Socket): void => {
    connectionCount += 1;
    socket.destroy();
  });

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return new RunningLocalTcpServer(
    server,
    (): number => connectionCount,
    `localhost:${readTcpServerPort(server).toString()}`,
  );
}

class RunningLocalTcpServer implements LocalTcpServerHandle {
  public constructor(
    private readonly server: Server,
    private readonly readConnectionCount: () => number,
    public readonly trustedHost: string,
  ) {}

  public connectionCount(): number {
    return this.readConnectionCount();
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
      this.server.close((error?: Error): void => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function readTcpServerPort(server: Server): number {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected local TCP server to listen on a TCP port.');
  }

  return address.port;
}

async function withTrustedOutboundHostsEnv(value: string, run: () => Promise<void>): Promise<void> {
  const previousValue: string | undefined = process.env.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS;
  process.env.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS = value;
  try {
    await run();
  } finally {
    if (previousValue === undefined) {
      delete process.env.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS;
    } else {
      process.env.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS = previousValue;
    }
  }
}

async function expectRejectedErrorChainToContain(run: () => Promise<void>, message: string): Promise<void> {
  const error: Error = await readRejectedError(run);
  expect(readErrorChainMessages(error)).toContainEqual(expect.stringContaining(message));
}

async function readRejectedError(run: () => Promise<void>): Promise<Error> {
  try {
    await run();
  } catch (caughtError) {
    if (caughtError instanceof Error) {
      return caughtError;
    }

    return new Error(String(caughtError));
  }

  throw new Error('Expected operation to reject.');
}

function readErrorChainMessages(error: Error): string[] {
  const messages: string[] = [];
  let currentError: Error | undefined = error;
  while (currentError !== undefined) {
    messages.push(currentError.message);
    currentError = (currentError as ErrorWithCause).cause;
  }

  return messages;
}

function createSyncTask(): WorkerClaimedGitSourceSyncTask {
  return {
    claimToken: 'claim-token',
    installationToken: 'installation-token',
    providerHost: 'github.com',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
    requestedBranchName: 'main',
    sourceId: 'src_123',
    taskId: 'sst_123',
    triggerCommitSha: null,
  };
}

function createResolutionTask(): WorkerClaimedGitSourceResolutionTask {
  return {
    branchName: 'main',
    commitSha: 'resolved-commit-sha',
    descriptorPath: 'compartment.yml',
    installationToken: 'installation-token',
    projectName: 'web',
    providerHost: 'github.com',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
    sourceBindingId: 'sbd_123',
    sourceEventId: 'sev_123',
    sourceId: 'src_123',
    targetEnvironmentName: 'production',
    taskId: 'srt_123',
  };
}
