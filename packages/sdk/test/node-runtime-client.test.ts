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
import type {
  NodeDeployRequest,
  NodeDeployResponse,
  NodeInspectDeploymentResponse,
  NodeStopDeploymentResponse,
  NodeTailLogsResponse,
  ResolvedCompartmentServiceRunConfig,
} from '@compartment/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeRequester } from '../src/http/node-request';
import { readNodeRequestRuntimeMessage } from '../src/http/node-request-error';
import type { NodeRequester } from '../src/http/node-request.types';
import { deployToNode } from '../src/services/node-runtime-deploy.service';
import { inspectNodeDeployment } from '../src/services/node-runtime-inspect.service';
import { stopNodeDeployment } from '../src/services/node-runtime-stop.service';
import { tailNodeDeploymentLogs } from '../src/services/node-runtime-logs.service';

interface ExpectedNodeRequest {
  body?: object | undefined;
  method: 'GET' | 'POST';
  pathname: string;
  query?: Record<string, string> | undefined;
}

interface NodeRuntimeTestServer {
  calls: NodeRequestCall[];
  socketPath: string;
}

interface NodeRuntimeTestResponse {
  body: object;
  status?: number | undefined;
}

interface NodeRequestCall {
  body: string;
  headers: IncomingHttpHeaders;
  method: string;
  url: string;
}

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(servers.map(async (server: Server): Promise<void> => await closeServer(server)));
  await Promise.all(
    temporaryDirectories.map(
      async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true }),
    ),
  );
  servers.length = 0;
  temporaryDirectories.length = 0;
});

describe('node runtime request services', (): void => {
  it('sends deploy requests to the node deploy endpoint', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTestServer([
      createJsonResponse(createNodeDeployResponse()),
    ]);
    const request: NodeRequester = createNodeRequesterFixture(server.socketPath);

    const deployResponse: NodeDeployResponse = await deployToNode(request, createNodeDeployRequest());

    expect(deployResponse.containerId).toBe('container_123');
    expectNodeRequest(server.calls[0]!, {
      body: createNodeDeployRequest(),
      method: 'POST',
      pathname: '/internal/deployments/deploy',
    });
  });

  it('sends inspect requests with the expected query fields', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTestServer([
      createJsonResponse(createNodeInspectDeploymentResponse()),
    ]);
    const request: NodeRequester = createNodeRequesterFixture(server.socketPath);

    const inspectResponse: NodeInspectDeploymentResponse = await inspectNodeDeployment(request, {
      deploymentId: 'dep_123',
      environmentName: 'production',
      projectName: 'smoke-web',
      readinessPath: '/healthz',
      readinessTimeoutMs: 30000,
      readinessType: 'http',
      serviceName: 'web',
    });

    expect(expectPresent(inspectResponse.deployment, 'deployment').containerId).toBe('container_123');
    expectNodeRequest(server.calls[0]!, {
      method: 'GET',
      pathname: '/internal/deployments/inspect',
      query: {
        deploymentId: 'dep_123',
        environmentName: 'production',
        projectName: 'smoke-web',
        readinessPath: '/healthz',
        readinessTimeoutMs: '30000',
        readinessType: 'http',
        serviceName: 'web',
      },
    });
  });

  it('sends logs requests with the expected query fields', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTestServer([
      createJsonResponse(createNodeTailLogsResponse()),
    ]);
    const request: NodeRequester = createNodeRequesterFixture(server.socketPath);

    const logsResponse: NodeTailLogsResponse = await tailNodeDeploymentLogs(request, {
      containerId: 'container_123',
      deploymentId: 'dep_123',
      environmentName: 'production',
      serviceName: 'web',
      since: '2026-03-23T12:00:00.000Z',
      tailLines: 50,
    });

    expect(logsResponse.lines).toHaveLength(1);
    expectNodeRequest(server.calls[0]!, {
      method: 'GET',
      pathname: '/internal/deployments/logs',
      query: {
        containerId: 'container_123',
        deploymentId: 'dep_123',
        environmentName: 'production',
        serviceName: 'web',
        since: '2026-03-23T12:00:00.000Z',
        tailLines: '50',
      },
    });
  });

  it('sends stop requests to the node stop endpoint', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTestServer([
      createJsonResponse(createNodeStopDeploymentResponse()),
    ]);
    const request: NodeRequester = createNodeRequesterFixture(server.socketPath);

    const stopResponse: NodeStopDeploymentResponse = await stopNodeDeployment(request, {
      containerId: 'container_123',
    });

    expect(stopResponse.stoppedAt).toBe('2026-03-24T10:00:00.000Z');
    expectNodeRequest(server.calls[0]!, {
      body: { containerId: 'container_123' },
      method: 'POST',
      pathname: '/internal/deployments/stop',
    });
  });

  it('rejects partial readiness query fields before issuing inspect requests', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTestServer([]);
    const request: NodeRequester = createNodeRequester({
      internalToken: 'worker-secret',
      nodeSocketPath: server.socketPath,
    });

    await expect(
      inspectNodeDeployment(request, {
        deploymentId: 'dep_123',
        environmentName: 'production',
        projectName: 'smoke-web',
        readinessPath: '/healthz',
        serviceName: 'web',
      }),
    ).rejects.toThrow('must be provided together');

    expect(server.calls).toHaveLength(0);
  });

  it('includes node endpoint details when runtime requests fail', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTestServer([
      createJsonResponse(
        {
          error: 'Not Found',
          message: 'Route POST:/internal/deployments/deploy not found',
        },
        404,
      ),
    ]);
    const request: NodeRequester = createNodeRequester({
      internalToken: 'worker-secret',
      nodeSocketPath: server.socketPath,
    });

    let failure: Error | undefined;
    try {
      await deployToNode(request, createNodeDeployRequest());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toContain('Node runtime request failed for /internal/deployments/deploy with status 404');
    expect(readNodeRequestRuntimeMessage(failure!)).toBeNull();
  });

  it('exposes the node error message for deployment failure persistence', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTestServer([
      createJsonResponse(
        {
          error: {
            code: 'unexpected',
            message: 'node deploy failed',
          },
        },
        500,
      ),
    ]);
    const request: NodeRequester = createNodeRequester({
      internalToken: 'worker-secret',
      nodeSocketPath: server.socketPath,
    });

    let failure: Error | undefined;
    try {
      await deployToNode(request, createNodeDeployRequest());
    } catch (error) {
      failure = error as Error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(readNodeRequestRuntimeMessage(failure!)).toBe('node deploy failed');
    expect(failure?.message).toContain('Node runtime request failed for /internal/deployments/deploy with status 500');
  });

  it('times out stalled node runtime requests', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startHangingNodeRuntimeTestServer();
    const request: NodeRequester = createNodeRequester({
      internalToken: 'worker-secret',
      nodeSocketPath: server.socketPath,
      requestTimeoutMs: 25,
    });

    await expect(deployToNode(request, createNodeDeployRequest())).rejects.toThrow(
      `Node runtime request timed out for /internal/deployments/deploy after 25ms via socket ${server.socketPath}.`,
    );
  });

  it('rejects non-JSON node runtime responses through the request promise', async (): Promise<void> => {
    const server: NodeRuntimeTestServer = await startNodeRuntimeTextResponseServer('not-json');
    const request: NodeRequester = createNodeRequesterFixture(server.socketPath);

    await expect(deployToNode(request, createNodeDeployRequest())).rejects.toThrow(
      'Node runtime returned a non-JSON response for /internal/deployments/deploy with status 200.',
    );
  });
});

function expectPresent<T>(value: T | null | undefined, label: string): T {
  expect(value, `${label} should be present`).not.toBeNull();
  expect(value, `${label} should be present`).not.toBeUndefined();
  return value as T;
}

function createNodeDeployRequest(): NodeDeployRequest {
  return {
    deploymentId: 'dep_123',
    environmentId: 'env_123',
    environmentName: 'production',
    imageRef: 'sha256:image',
    projectId: 'prj_123',
    projectName: 'smoke-web',
    readiness: {
      path: '/healthz',
      timeoutMs: 30000,
      type: 'http',
    },
    run: createRun(),
    routeHost: 'smoke-web.localhost',
    runtimeEnv: {},
    serviceId: 'svc_123',
    serviceName: 'web',
  };
}

function createRun(): ResolvedCompartmentServiceRunConfig {
  return {
    restart: {
      policy: 'on-failure',
    },
  };
}

function createNodeDeployResponse(): NodeDeployResponse {
  return {
    containerId: 'container_123',
    imageRef: 'sha256:image',
    routeHost: 'smoke-web.localhost',
    upstreamHost: '127.0.0.1',
    upstreamPort: 31000,
    startedAt: '2026-03-23T12:00:00.000Z',
  };
}

function createNodeTailLogsResponse(): NodeTailLogsResponse {
  return {
    lines: [
      {
        deploymentId: 'dep_123',
        environmentName: 'production',
        message: 'boot complete',
        serviceName: 'web',
        stream: 'stdout',
        timestamp: '2026-03-23T12:00:00.000Z',
      },
    ],
  };
}

function createNodeInspectDeploymentResponse(): NodeInspectDeploymentResponse {
  return {
    deployment: {
      containerId: 'container_123',
      imageRef: 'sha256:image',
      routeHost: 'smoke-web.localhost',
      upstreamHost: '127.0.0.1',
      upstreamPort: 31000,
    },
  };
}

function createNodeStopDeploymentResponse(): NodeStopDeploymentResponse {
  return {
    stoppedAt: '2026-03-24T10:00:00.000Z',
  };
}

function createNodeRequesterFixture(socketPath: string): NodeRequester {
  return createNodeRequester({
    internalToken: 'worker-secret',
    nodeSocketPath: socketPath,
  });
}

function createJsonResponse(body: object, status: number = 200): NodeRuntimeTestResponse {
  return {
    body,
    status,
  };
}

async function startNodeRuntimeTestServer(responses: NodeRuntimeTestResponse[]): Promise<NodeRuntimeTestServer> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-sdk-node-'));
  temporaryDirectories.push(directory);
  const socketPath: string = join(directory, 'agent.sock');
  const calls: NodeRequestCall[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    void handleNodeRuntimeTestRequest(request, response, calls, responses);
  });

  await listenOnSocket(server, socketPath);
  servers.push(server);
  return {
    calls,
    socketPath,
  };
}

async function startHangingNodeRuntimeTestServer(): Promise<NodeRuntimeTestServer> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-sdk-node-'));
  temporaryDirectories.push(directory);
  const socketPath: string = join(directory, 'agent.sock');
  const calls: NodeRequestCall[] = [];
  const server: Server = createServer((request: IncomingMessage): void => {
    void readRequestBody(request).then((body: string): void => {
      calls.push({
        body,
        headers: request.headers,
        method: request.method ?? '',
        url: request.url ?? '',
      });
    });
  });

  await listenOnSocket(server, socketPath);
  servers.push(server);
  return {
    calls,
    socketPath,
  };
}

async function startNodeRuntimeTextResponseServer(body: string): Promise<NodeRuntimeTestServer> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-sdk-node-'));
  temporaryDirectories.push(directory);
  const socketPath: string = join(directory, 'agent.sock');
  const calls: NodeRequestCall[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    void readRequestBody(request).then((requestBody: string): void => {
      calls.push({
        body: requestBody,
        headers: request.headers,
        method: request.method ?? '',
        url: request.url ?? '',
      });
      response.statusCode = 200;
      response.setHeader('content-type', 'text/plain');
      response.end(body);
    });
  });

  await listenOnSocket(server, socketPath);
  servers.push(server);
  return {
    calls,
    socketPath,
  };
}

async function handleNodeRuntimeTestRequest(
  request: IncomingMessage,
  response: ServerResponse,
  calls: NodeRequestCall[],
  responses: NodeRuntimeTestResponse[],
): Promise<void> {
  calls.push({
    body: await readRequestBody(request),
    headers: request.headers,
    method: request.method ?? '',
    url: request.url ?? '',
  });
  const testResponse: NodeRuntimeTestResponse = responses.shift() ?? createJsonResponse({}, 404);
  response.statusCode = testResponse.status ?? 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(testResponse.body));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer<ArrayBufferLike>[] = [];
  const bodyStream: AsyncIterable<string | Buffer<ArrayBufferLike>> = request;
  for await (const chunk of bodyStream) {
    chunks.push(readRequestBodyChunk(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function readRequestBodyChunk(chunk: string | Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
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

function expectNodeRequest(call: NodeRequestCall, expected: ExpectedNodeRequest): void {
  const url: URL = new URL(call.url, 'http://node-agent.local');

  expect(call.method).toBe(expected.method);
  expect(url.pathname).toBe(expected.pathname);
  expect(readAuthorizationHeader(call)).toBe('Bearer worker-secret');

  if (expected.query !== undefined) {
    for (const [key, value] of Object.entries(expected.query)) {
      expect(url.searchParams.get(key)).toBe(value);
    }
  }

  if (expected.body !== undefined) {
    expect(call.body).toBe(JSON.stringify(expected.body));
  }
}

function readAuthorizationHeader(call: NodeRequestCall): string | undefined {
  return call.headers.authorization;
}
