import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compartmentSystemIssuePasswordResetPathname } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { readSystemClientConfig } from '../src/system-api';
import { requestSystemApi } from '../src/system-api-client';

describe.sequential('system API client', (): void => {
  const directoriesToRemove: string[] = [];

  afterEach(async (): Promise<void> => {
    await Promise.all(
      directoriesToRemove.map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
    directoriesToRemove.length = 0;
  });

  it('maps system API error envelopes to thrown messages', async (): Promise<void> => {
    const socketPath: string = await createTemporarySocketPath(directoriesToRemove);
    const server: Server = await listenOnSocket(
      socketPath,
      (_request: IncomingMessage, response: ServerResponse<IncomingMessage>): void => {
        response.statusCode = 404;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            error: {
              code: 'password_reset_user_not_found',
              message: 'The requested user was not found.',
            },
          }),
        );
      },
    );

    try {
      await expect(
        requestSystemApi(
          {
            socketPath,
            token: 'system-token',
          },
          {
            body: { email: 'missing@example.com' },
            method: 'POST',
            parse: (value: JsonValue | null): JsonValue | null => value,
            path: compartmentSystemIssuePasswordResetPathname,
          },
        ),
      ).rejects.toThrow('The requested user was not found.');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects noncanonical system API sockets', (): void => {
    expect((): void => {
      readSystemClientConfig({
        COMPARTMENT_SYSTEM_API_SOCKET: '/var/run/compartment/custom-api/system-api.sock',
        COMPARTMENT_SYSTEM_TOKEN: 'system-token',
      });
    }).toThrow(
      'The self-hosted environment has unsupported COMPARTMENT_SYSTEM_API_SOCKET value /var/run/compartment/custom-api/system-api.sock. Expected /var/run/compartment/api/system-api.sock.',
    );
  });
});

async function createTemporarySocketPath(directoriesToRemove: string[]): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-system-api-'));
  directoriesToRemove.push(directory);
  return join(directory, 'system-api.sock');
}

async function listenOnSocket(
  socketPath: string,
  handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void,
): Promise<Server> {
  const server: Server = createServer(handler);

  await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
    server.once('error', reject);
    server.listen(socketPath, (): void => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
