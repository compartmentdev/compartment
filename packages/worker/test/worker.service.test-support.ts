import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type Mock } from 'vitest';
import {
  nodeRuntimeNetworkReservationCleanupPathname as runtimeNetworkReservationCleanupPathname,
  nodeRuntimeNetworkReservationPathname as runtimeNetworkReservationPathname,
  type NodeDeployRequest,
  type NodePreviousDeployment,
  type ResolvedCompartmentServiceRunConfig,
  type ResolvedOptionalServiceReadinessConfig,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type FetchCall = [input: string | URL | Request, init?: RequestInit | undefined];
export type NodeRuntimeRouteHandler = (call: NodeRuntimeRequestCall) => NodeRuntimeTestResponse;

export interface NodeRuntimeRequestCall {
  body: Record<string, JsonValue>;
  headers: IncomingHttpHeaders;
  method: string;
  url: string;
}

export interface NodeRuntimeTestResponse {
  body: object;
  status?: number | undefined;
}

export interface NodeRuntimeTestServer {
  calls: NodeRuntimeRequestCall[];
}

export interface NodeRuntimeTestServerOptions {
  reservationResponse?: NodeRuntimeTestResponse | undefined;
}

interface NodeDeploySuccessResponseBody {
  containerId: string;
  imageRef: string;
  routeHost: string;
  startedAt: string;
  upstreamHost: string;
  upstreamPort: number;
}

export function createNodeDeployRequest(
  previousDeployment: NodePreviousDeployment | undefined = undefined,
  readiness: ResolvedOptionalServiceReadinessConfig = {
    path: '/healthz',
    timeoutMs: 30000,
    type: 'http',
  },
): NodeDeployRequest {
  return {
    deploymentId: 'dep_123',
    environmentId: 'env_123',
    environmentName: 'production',
    imageRef: 'sha256:image',
    ...(previousDeployment !== undefined ? { previousDeployment } : {}),
    projectId: 'prj_123',
    projectName: 'smoke-web',
    readiness,
    run: createRun(),
    routeHost: 'smoke-web.localhost',
    runtimeEnv: {},
    runtimeNetwork: {
      requiresResourceNetwork: false,
    },
    serviceId: 'svc_123',
    serviceName: 'web',
  };
}

export function createNodeDeploySuccessResponse(
  input: Partial<NodeDeploySuccessResponseBody> = {},
): NodeRuntimeTestResponse {
  return {
    body: {
      containerId: 'container_123',
      imageRef: 'sha256:image',
      routeHost: 'smoke-web.localhost',
      startedAt: '2026-03-23T12:00:00.000Z',
      upstreamHost: '127.0.0.1',
      upstreamPort: 31000,
      ...input,
    },
  };
}

export function createClaimedDeploymentPayload(
  nodeSocketPath: string,
  input: Partial<WorkerClaimedDeployment> = {},
): WorkerClaimedDeployment {
  return {
    deploymentId: 'dep_123',
    deploymentRunId: 'drn_123',
    environmentId: 'env_123',
    environmentName: 'production',
    node: {
      id: 'node_123',
      name: 'local-node',
      nodeSocketPath,
    },
    projectId: 'prj_123',
    projectName: 'smoke-web',
    readiness: {
      path: '/healthz',
      timeoutMs: 30000,
      type: 'http',
    },
    release: null,
    requiresSourceRoutesFile: false,
    run: createRun(),
    artifact: {
      id: 'art_123',
      imageRef: null,
      sourceDigest: 'sha256-source',
    },
    routeHost: 'smoke-web.localhost',
    buildEnv: {},
    runtimeEnv: {},
    runtimeNetwork: {
      requiresResourceNetwork: false,
    },
    service: {
      build: {
        env: [],
        include: [],
        packages: {
          build: [],
          runtime: [],
        },
        strategy: 'auto',
      },
      id: 'svc_123',
      kind: 'web',
      name: 'web',
      path: '.',
    },
    ...input,
  };
}

export function createEmptyGitSourceResolutionTaskClaimResponse(): Response {
  return new Response(JSON.stringify({ task: null }), { status: 200 });
}

export function createWorkerCompleteDeploymentResponse(): { cleanupArtifacts: [] } {
  return {
    cleanupArtifacts: [],
  };
}

export function readFetchUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

export async function startNodeRuntimeServer(
  socketPath: string,
  handler: NodeRuntimeRouteHandler,
  servers: Server[],
  options: NodeRuntimeTestServerOptions = {},
): Promise<NodeRuntimeTestServer> {
  await mkdir(dirname(socketPath), { recursive: true });
  const calls: NodeRuntimeRequestCall[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    void handleNodeRuntimeRequest(request, response, calls, handler, options);
  });
  await listenOnSocket(server, socketPath);
  servers.push(server);
  return { calls };
}

export async function closeServer(server: Server): Promise<void> {
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

export function readAuthorizationHeader(init: RequestInit | undefined): string | null {
  const headers: Headers | undefined = init?.headers instanceof Headers ? init.headers : undefined;

  return headers?.get('Authorization') ?? null;
}

export function readJsonBody(init: RequestInit | undefined): Record<string, JsonValue> {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected a JSON string request body.');
  }

  return JSON.parse(init.body) as Record<string, JsonValue>;
}

export function readRuntimeEventMessages(fetchMock: Mock<FetchImplementation>): string[] {
  return fetchMock.mock.calls.flatMap((call: FetchCall): string[] => {
    const url: string = readFetchUrl(call[0]);
    if (!url.endsWith('/internal/deployments/runtime-events')) {
      return [];
    }

    const payload: Record<string, JsonValue> = readJsonBody(call[1]);
    const message: JsonValue | undefined = payload.message;
    return typeof message === 'string' ? [message] : [];
  });
}

export function readRuntimeStatePromotions(fetchMock: Mock<FetchImplementation>): JsonValue[] {
  return fetchMock.mock.calls.flatMap((call: FetchCall): JsonValue[] => {
    const url: string = readFetchUrl(call[0]);
    if (!url.endsWith('/internal/deployments/runtime-state')) {
      return [];
    }

    const promotionStage: JsonValue | undefined = readJsonBody(call[1]).promotionStage;
    return promotionStage === undefined ? [] : [promotionStage];
  });
}

function createRun(): ResolvedCompartmentServiceRunConfig {
  return {
    restart: {
      policy: 'on-failure',
    },
  };
}

async function handleNodeRuntimeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  calls: NodeRuntimeRequestCall[],
  handler: NodeRuntimeRouteHandler,
  options: NodeRuntimeTestServerOptions,
): Promise<void> {
  const call: NodeRuntimeRequestCall = {
    body: await readNodeRuntimeRequestBody(request),
    headers: request.headers,
    method: request.method ?? '',
    url: request.url ?? '',
  };
  expect(call.headers.authorization).toBe('Bearer worker-secret');
  const defaultResponse: NodeRuntimeTestResponse | null = readDefaultNodeRuntimeResponse(call, options);
  if (defaultResponse !== null) {
    calls.push(call);
    writeNodeRuntimeResponse(response, defaultResponse);
    return;
  }

  calls.push(call);
  const testResponse: NodeRuntimeTestResponse = handler(call);
  writeNodeRuntimeResponse(response, testResponse);
}

function readDefaultNodeRuntimeResponse(
  call: NodeRuntimeRequestCall,
  options: NodeRuntimeTestServerOptions,
): NodeRuntimeTestResponse | null {
  if (call.url === runtimeNetworkReservationPathname) {
    return (
      options.reservationResponse ?? {
        body: {
          expiresAt: '2026-03-23T14:00:00.000Z',
          newlyCreatedNetworkNames: [],
          reservationId: 'dep_123',
          reservedNetworkNames: [],
        },
      }
    );
  }
  if (call.url === runtimeNetworkReservationCleanupPathname) {
    return {
      body: {
        cleanedAt: '2026-03-23T12:05:00.000Z',
      },
    };
  }

  return null;
}

function writeNodeRuntimeResponse(response: ServerResponse, testResponse: NodeRuntimeTestResponse): void {
  response.statusCode = testResponse.status ?? 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(testResponse.body));
}

async function readNodeRuntimeRequestBody(request: IncomingMessage): Promise<Record<string, JsonValue>> {
  const chunks: Buffer<ArrayBufferLike>[] = [];
  const bodyStream: AsyncIterable<string | Buffer<ArrayBufferLike>> = request;
  for await (const chunk of bodyStream) {
    chunks.push(readNodeRuntimeBodyChunk(chunk));
  }
  const text: string = Buffer.concat(chunks).toString('utf8');
  if (text === '') {
    return {};
  }

  return JSON.parse(text) as Record<string, JsonValue>;
}

function readNodeRuntimeBodyChunk(chunk: string | Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
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
