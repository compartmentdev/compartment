import {
  compartmentInternalAppAccessStatePathname,
  compartmentInternalNodeRegistrationPathname,
  nodeRegistrationResponseSchema,
  workerClaimDeploymentResponseSchema,
  workerClaimNextDeploymentPathname,
  workerRecoverDeploymentsPathname,
  type NodeRegistrationResponse,
  type WorkerClaimDeploymentResponse,
  type WorkerRecoverDeploymentsResponse,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import Fastify, { type FastifyReply, type FastifyRequest, type LightMyRequestResponse } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { registerApiRequestLogging } from '../src/http/request-logging';
import type {
  claimQueuedDeploymentForWorker,
  recoverOrphanedRunningDeploymentsForWorker,
} from '../src/services/deployment-worker.service';
import type { registerNode } from '../src/services/node.service';
import type { readAppAccessState } from '../src/services/app-access-state.service';
import type { buildWorkerClaimDeploymentResponse } from '../src/routes/internal/worker-claim.presenter';
import { applyApiRouteTestEnv, injectApiRoute, injectJson, withApiRouteApp } from './api-route-test.harness';

type BuildWorkerClaimDeploymentResponse = typeof buildWorkerClaimDeploymentResponse;
type ClaimQueuedDeploymentForWorker = typeof claimQueuedDeploymentForWorker;
type ReadAppAccessState = typeof readAppAccessState;
type RecoverOrphanedRunningDeploymentsForWorker = typeof recoverOrphanedRunningDeploymentsForWorker;
type RegisterNode = typeof registerNode;
const routeTestNodeAgentSocketPath: string = '/tmp/compartment/test/node/agent.sock';

interface InternalRequestLoggingMocks {
  buildWorkerClaimDeploymentResponse: Mock<BuildWorkerClaimDeploymentResponse>;
  claimQueuedDeploymentForWorker: Mock<ClaimQueuedDeploymentForWorker>;
  readAppAccessState: Mock<ReadAppAccessState>;
  recoverOrphanedRunningDeploymentsForWorker: Mock<RecoverOrphanedRunningDeploymentsForWorker>;
  registerNode: Mock<RegisterNode>;
}

const mocks: InternalRequestLoggingMocks = vi.hoisted(
  (): InternalRequestLoggingMocks => ({
    buildWorkerClaimDeploymentResponse: vi.fn<BuildWorkerClaimDeploymentResponse>(),
    claimQueuedDeploymentForWorker: vi.fn<ClaimQueuedDeploymentForWorker>(),
    readAppAccessState: vi.fn<ReadAppAccessState>(),
    recoverOrphanedRunningDeploymentsForWorker: vi.fn<RecoverOrphanedRunningDeploymentsForWorker>(),
    registerNode: vi.fn<RegisterNode>(),
  }),
);

vi.mock(
  '../src/services/deployment-worker.service',
  (): {
    claimQueuedDeploymentForWorker: Mock<ClaimQueuedDeploymentForWorker>;
    recoverOrphanedRunningDeploymentsForWorker: Mock<RecoverOrphanedRunningDeploymentsForWorker>;
  } => ({
    claimQueuedDeploymentForWorker: mocks.claimQueuedDeploymentForWorker,
    recoverOrphanedRunningDeploymentsForWorker: mocks.recoverOrphanedRunningDeploymentsForWorker,
  }),
);

vi.mock('../src/services/app-access-state.service', (): { readAppAccessState: Mock<ReadAppAccessState> } => ({
  readAppAccessState: mocks.readAppAccessState,
}));

vi.mock('../src/services/node.service', (): { registerNode: Mock<RegisterNode> } => ({
  registerNode: mocks.registerNode,
}));

vi.mock(
  '../src/routes/internal/worker-claim.presenter',
  (): { buildWorkerClaimDeploymentResponse: Mock<BuildWorkerClaimDeploymentResponse> } => ({
    buildWorkerClaimDeploymentResponse: mocks.buildWorkerClaimDeploymentResponse,
  }),
);

describe('internal request logging', (): void => {
  afterEach((): void => {
    mocks.buildWorkerClaimDeploymentResponse.mockReset();
    mocks.claimQueuedDeploymentForWorker.mockReset();
    mocks.readAppAccessState.mockReset();
    mocks.recoverOrphanedRunningDeploymentsForWorker.mockReset();
    mocks.registerNode.mockReset();
  });

  it('keeps successful polling access requests out of the API logs', async (): Promise<void> => {
    applyApiRouteTestEnv({ logLevel: 'info' });
    mocks.buildWorkerClaimDeploymentResponse.mockReturnValue(
      workerClaimDeploymentResponseSchema.parse({ deployment: null }),
    );
    mocks.claimQueuedDeploymentForWorker.mockResolvedValueOnce(null);
    mocks.readAppAccessState.mockResolvedValueOnce(null);
    mocks.recoverOrphanedRunningDeploymentsForWorker.mockResolvedValueOnce({
      cleanupArtifacts: [],
      recoveredDeploymentCount: 0,
    } satisfies WorkerRecoverDeploymentsResponse);

    const output: string = await captureStdout(async (): Promise<void> => {
      await withApiRouteApp(async (app: ApiApp): Promise<void> => {
        await injectPollingRequest(app, {
          authorization: 'Bearer test-runtime-control-token',
          method: 'POST',
          url: workerClaimNextDeploymentPathname,
        });
        await injectPollingRequest(app, {
          authorization: 'Bearer test-runtime-control-token',
          method: 'POST',
          url: `${workerRecoverDeploymentsPathname}?mode=pending-drain`,
        });
        await injectPollingRequest(app, {
          authorization: 'Bearer test-edge-token',
          method: 'GET',
          url: compartmentInternalAppAccessStatePathname,
        });
      });
    });

    expect(output).not.toContain(workerClaimNextDeploymentPathname);
    expect(output).not.toContain(workerRecoverDeploymentsPathname);
    expect(output).not.toContain(compartmentInternalAppAccessStatePathname);
  });

  it('keeps failed polling requests visible in the API logs', async (): Promise<void> => {
    applyApiRouteTestEnv({ logLevel: 'info' });

    const output: string = await captureStdout(async (): Promise<void> => {
      await withApiRouteApp(async (app: ApiApp): Promise<void> => {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          headers: {
            accept: 'application/json',
            authorization: 'Bearer wrong-token',
          },
          method: 'POST',
          timeoutMs: 1000,
          url: workerClaimNextDeploymentPathname,
        });

        expect(response.statusCode).toBe(401);
      });
    });

    expect(output).toContain(workerClaimNextDeploymentPathname);
    expect(output).toContain('request completed');
    expect(output).toContain('responseTime');
  });

  it('keeps non-polling internal access logs enabled', async (): Promise<void> => {
    applyApiRouteTestEnv({ logLevel: 'info' });
    mocks.registerNode.mockResolvedValueOnce({
      node: {
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        id: 'node_123',
        name: 'local-node',
        nodeSocketPath: routeTestNodeAgentSocketPath,
        nodeVersion: '0.1.0',
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      registeredAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const output: string = await captureStdout(async (): Promise<void> => {
      await withApiRouteApp(async (app: ApiApp): Promise<void> => {
        const response: LightMyRequestResponse = await injectJson(app, {
          headers: {
            accept: 'application/json',
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'POST',
          payload: {
            nodeName: 'local-node',
            nodeSocketPath: routeTestNodeAgentSocketPath,
            nodeVersion: '0.1.0',
          },
          timeoutMs: 1000,
          url: compartmentInternalNodeRegistrationPathname,
        });
        const payload: JsonValue = response.json();

        expect(response.statusCode).toBe(200);
        expect(nodeRegistrationResponseSchema.parse(payload)).toEqual<NodeRegistrationResponse>({
          node: {
            id: 'node_123',
            name: 'local-node',
            nodeSocketPath: routeTestNodeAgentSocketPath,
            nodeVersion: '0.1.0',
          },
          registeredAt: '2025-01-01T00:00:00.000Z',
        });
      });
    });

    expect(output).toContain(compartmentInternalNodeRegistrationPathname);
    expect(output).toContain('incoming request');
    expect(output).toContain('request completed');
    expect(output).toContain('responseTime');
  });

  it('omits sensitive activate query values from request log payloads', async (): Promise<void> => {
    const output: string = await captureStdout(async (): Promise<void> => {
      await withRequestLoggingOnlyApp(async (app: ApiApp): Promise<void> => {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          method: 'GET',
          timeoutMs: 1000,
          url: '/activate?email=a&token=t',
        });

        expect(response.statusCode).toBe(204);
      });
    });

    expect(output).toContain('"path":"/activate"');
    expect(output).not.toContain('?email=');
    expect(output).not.toContain('email');
    expect(output).not.toContain('token');
  });

  it('preserves the claimed-deployment event log while polling access logs stay quiet', async (): Promise<void> => {
    applyApiRouteTestEnv({ logLevel: 'info' });
    mocks.buildWorkerClaimDeploymentResponse.mockReturnValue(createClaimedDeploymentResponse());
    mocks.claimQueuedDeploymentForWorker.mockResolvedValueOnce(null);

    const output: string = await captureStdout(async (): Promise<void> => {
      await withApiRouteApp(async (app: ApiApp): Promise<void> => {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          headers: {
            accept: 'application/json',
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'POST',
          timeoutMs: 1000,
          url: workerClaimNextDeploymentPathname,
        });

        expect(response.statusCode).toBe(200);
        expect(workerClaimDeploymentResponseSchema.parse(response.json())).toEqual(createClaimedDeploymentResponse());
      });
    });

    expect(output).toContain('Claimed queued deployment for worker.');
    expect(output).not.toContain('incoming request');
    expect(output).not.toContain('request completed');
  });
});

interface PollingRouteRequest {
  authorization: string;
  method: 'GET' | 'POST';
  url: string;
}

function createClaimedDeploymentResponse(): WorkerClaimDeploymentResponse {
  return workerClaimDeploymentResponseSchema.parse({
    deployment: {
      artifact: {
        id: 'artifact_123',
        imageRef: null,
        sourceDigest: 'sha256:abc123',
      },
      buildEnv: {},
      deploymentId: 'dep_123',
      deploymentRunId: 'drn_123',
      environmentId: 'env_123',
      environmentName: 'prod',
      node: {
        id: 'node_123',
        name: 'local-node',
        nodeSocketPath: '/tmp/compartment/api-test/node/worker-claim.sock',
      },
      projectId: 'project_123',
      projectName: 'project-123',
      readiness: null,
      release: null,
      requiresSourceRoutesFile: false,
      routeHost: 'app.localhost',
      run: {
        restart: {
          policy: 'on-failure',
        },
      },
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
        id: 'service_123',
        kind: 'web',
        name: 'web',
        path: 'services/web',
      },
    },
  });
}

async function injectPollingRequest(app: ApiApp, input: PollingRouteRequest): Promise<void> {
  const response: LightMyRequestResponse = await injectApiRoute(app, {
    headers: {
      accept: 'application/json',
      authorization: input.authorization,
    },
    method: input.method,
    timeoutMs: 1000,
    url: input.url,
  });

  expect(response.statusCode).toBe(200);
}

async function withRequestLoggingOnlyApp(run: (app: ApiApp) => Promise<void>): Promise<void> {
  const app: ApiApp = Fastify({
    disableRequestLogging: true,
    loggerInstance: pino({
      base: {
        service: 'api',
      },
      level: 'info',
    }),
  });
  registerApiRequestLogging(app);
  app.get(
    '/activate',
    async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => await reply.status(204).send(),
  );

  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const originalWrite: typeof process.stdout.write = process.stdout.write.bind(process.stdout);
  let output: string = '';

  process.stdout.write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (typeof encoding === 'function') {
      encoding();
    } else if (callback !== undefined) {
      callback();
    }

    return true;
  };

  try {
    await run();
    await new Promise<void>((resolve: () => void): void => {
      setImmediate(resolve);
    });
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}
