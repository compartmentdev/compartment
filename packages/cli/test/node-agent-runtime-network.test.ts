import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SelfHostedHostSocketPathsSourceModule from '../src/self-hosted-host-socket-paths';

type ReadCanonicalNodeAgentSocketPath = (environmentValues: Record<string, string>) => string;

interface NodeAgentRuntimeNetworkRequest {
  body: string;
  headers: IncomingHttpHeaders;
  method: string;
  url: string;
}

interface NodeAgentRuntimeNetworkTestServer {
  calls: NodeAgentRuntimeNetworkRequest[];
  socketPath: string;
}

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

describe('node agent runtime network reconcile', (): void => {
  beforeEach((): void => {
    vi.resetModules();
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('../src/self-hosted-host-socket-paths');
    await Promise.all(servers.map(async (server: Server): Promise<void> => await closeServer(server)));
    await Promise.all(
      temporaryDirectories.map(
        async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true }),
      ),
    );
    servers.length = 0;
    temporaryDirectories.length = 0;
  });

  it('sends runtime network reconcile requests with self-hosted runtime control auth', async (): Promise<void> => {
    const server: NodeAgentRuntimeNetworkTestServer = await startNodeAgentRuntimeNetworkTestServer();
    mockNodeAgentSocketPath(server.socketPath);
    const { reconcileNodeAgentRuntimeNetworks } = await import('../src/node-agent-runtime-network');

    await reconcileNodeAgentRuntimeNetworks({
      environmentText: createEnvironmentText(),
    });

    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toEqual(
      expect.objectContaining({
        body: '',
        method: 'POST',
        url: '/internal/runtime-networks/reconcile',
      }),
    );
    expect(server.calls[0]?.headers.authorization).toBe('Bearer runtime-token');
  });
});

function mockNodeAgentSocketPath(socketPath: string): void {
  vi.doMock(
    '../src/self-hosted-host-socket-paths',
    async (
      importOriginal: () => Promise<typeof SelfHostedHostSocketPathsSourceModule>,
    ): Promise<typeof SelfHostedHostSocketPathsSourceModule> => {
      const actualModule: typeof SelfHostedHostSocketPathsSourceModule = await importOriginal();
      return {
        ...actualModule,
        readCanonicalNodeAgentSocketPath: vi.fn<ReadCanonicalNodeAgentSocketPath>().mockReturnValue(socketPath),
      };
    },
  );
}

async function startNodeAgentRuntimeNetworkTestServer(): Promise<NodeAgentRuntimeNetworkTestServer> {
  const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-node-agent-network-'));
  temporaryDirectories.push(temporaryDirectory);
  const calls: NodeAgentRuntimeNetworkRequest[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer<ArrayBufferLike>[] = [];
    request.on('data', (chunk: Buffer | string): void => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', (): void => {
      calls.push({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: request.headers,
        method: request.method ?? '',
        url: request.url ?? '',
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true }));
    });
  });
  servers.push(server);

  const socketPath: string = join(temporaryDirectory, 'agent.sock');
  await listenOnSocket(server, socketPath);

  return {
    calls,
    socketPath,
  };
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
    server.close((error: Error | undefined): void => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function createEnvironmentText(): string {
  return `COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock
COMPARTMENT_RUNTIME_CONTROL_TOKEN=runtime-token
`;
}
