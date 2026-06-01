import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createErrorResponse,
  errorResponseSchema,
  nodeRuntimeDockerErrorCode,
  nodeRuntimeNetworkCapacityExhaustedErrorCode,
  nodeRuntimeServiceReadinessFailedErrorCode,
  type NodeRuntimeNetworkErrorCode,
  type ErrorResponse,
} from '@compartment/contracts';
import { createNodeRequester, type NodeRequester } from '@compartment/sdk';
import Fastify, { type LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ApiApp } from '../src/app.types';
import { registerApiErrorHandler } from '../src/http/error-handler';

interface NodeSuccessResponse {
  ok: true;
}

interface NodeRuntimeErrorFixture {
  code: NodeRuntimeNetworkErrorCode;
  message: string;
}

class NodeErrorServer {
  public constructor(
    public readonly socketPath: string,
    private readonly server: Server,
    private readonly socketDirectory: string,
  ) {}

  public async close(): Promise<void> {
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
      this.server.close((error?: Error): void => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await rm(this.socketDirectory, { force: true, recursive: true });
  }
}

const nodeSuccessResponseSchema: z.ZodType<NodeSuccessResponse> = z
  .object({
    ok: z.literal(true),
  })
  .strict();

const surfacedNodeNetworkErrors: NodeRuntimeErrorFixture[] = [
  {
    code: nodeRuntimeDockerErrorCode,
    message: 'Docker Engine rejected runtime network creation: all predefined address pools have been fully subnetted.',
  },
  {
    code: nodeRuntimeNetworkCapacityExhaustedErrorCode,
    message: 'Docker runtime network pool 10.250.0.0/29 has no available /29 subnets.',
  },
];

let nodeServers: NodeErrorServer[] = [];

describe('API error handler', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(nodeServers.map(async (server: NodeErrorServer): Promise<void> => await server.close()));
    nodeServers = [];
  });

  it('surfaces expected node service runtime failures', async (): Promise<void> => {
    const nodeServer: NodeErrorServer = await startNodeErrorServer(
      createErrorResponse(
        nodeRuntimeServiceReadinessFailedErrorCode,
        'runtime readiness failed: Container on port 3000 did not become healthy before 5000ms.',
      ),
    );
    const app: ApiApp = await createNodeRequestThrowingApp(nodeServer.socketPath);

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/test-node-request',
      });
      const payload: ErrorResponse = errorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(500);
      expect(payload.error).toEqual({
        code: nodeRuntimeServiceReadinessFailedErrorCode,
        message: 'runtime readiness failed: Container on port 3000 did not become healthy before 5000ms.',
      });
    } finally {
      await app.close();
    }
  });

  it.each(surfacedNodeNetworkErrors)(
    'surfaces expected node network runtime failures for $code',
    async ({ code, message }: NodeRuntimeErrorFixture): Promise<void> => {
      const nodeServer: NodeErrorServer = await startNodeErrorServer(createErrorResponse(code, message));
      const app: ApiApp = await createNodeRequestThrowingApp(nodeServer.socketPath);

      try {
        const response: LightMyRequestResponse = await app.inject({
          method: 'POST',
          url: '/test-node-request',
        });
        const payload: ErrorResponse = errorResponseSchema.parse(response.json());

        expect(response.statusCode).toBe(500);
        expect(payload.error).toEqual({
          code,
          message,
        });
      } finally {
        await app.close();
      }
    },
  );

  it('keeps unexpected node runtime failures generic', async (): Promise<void> => {
    const nodeServer: NodeErrorServer = await startNodeErrorServer(
      createErrorResponse('unexpected_node_failure', 'unexpected runtime detail'),
    );
    const app: ApiApp = await createNodeRequestThrowingApp(nodeServer.socketPath);

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/test-node-request',
      });
      const payload: ErrorResponse = errorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(500);
      expect(payload.error).toEqual({
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      });
    } finally {
      await app.close();
    }
  });
});

async function createNodeRequestThrowingApp(socketPath: string): Promise<ApiApp> {
  const app: ApiApp = Fastify();
  registerApiErrorHandler(app);
  app.post('/test-node-request', async (): Promise<{ ok: true }> => {
    const request: NodeRequester = createNodeRequester({
      internalToken: 'test-runtime-control-token',
      nodeSocketPath: socketPath,
    });

    return await request({
      body: {},
      method: 'POST',
      path: '/internal/test',
      schema: nodeSuccessResponseSchema,
    });
  });
  await app.ready();
  return app;
}

async function startNodeErrorServer(errorBody: ErrorResponse): Promise<NodeErrorServer> {
  const socketDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-api-node-error-'));
  const socketPath: string = join(socketDirectory, 'node.sock');
  const server: Server = createServer((_request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify(errorBody));
  });

  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  const nodeServer: NodeErrorServer = new NodeErrorServer(socketPath, server, socketDirectory);

  nodeServers.push(nodeServer);
  return nodeServer;
}
