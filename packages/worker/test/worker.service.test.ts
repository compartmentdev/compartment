import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createErrorResponse,
  type WorkerClaimedDeployment,
  workerClaimNextGitSourceResolutionTaskPathname,
  workerClaimNextDeploymentPathname,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type { CompartmentBinaryRequester, CompartmentRequester } from '@compartment/sdk';
import { runWorkerIteration } from '../src/services/worker.service';
import type { runScheduledResourceOperationIteration } from '../src/services/worker-resource-operation-scheduler.service';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import {
  closeServer,
  createClaimedDeploymentPayload as createClaimedDeploymentPayloadForNode,
  createEmptyGitSourceResolutionTaskClaimResponse,
  createNodeDeployRequest,
  createNodeDeploySuccessResponse,
  createWorkerCompleteDeploymentResponse,
  readAuthorizationHeader,
  readFetchUrl,
  readJsonBody,
  readRuntimeEventMessages,
  readRuntimeStatePromotions,
  startNodeRuntimeServer as startNodeRuntimeServerWithRegistry,
  type FetchCall,
  type FetchImplementation,
  type NodeRuntimeRequestCall,
  type NodeRuntimeRouteHandler,
  type NodeRuntimeTestResponse,
  type NodeRuntimeTestServer,
} from './worker.service.test-support';

type BuildReleaseImageFromSource = (
  request: CompartmentRequester,
  archiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
) => Promise<string>;
type RunScheduledResourceOperationIteration = typeof runScheduledResourceOperationIteration;

interface WorkerServiceTestMocks {
  buildReleaseImageFromSource: Mock<BuildReleaseImageFromSource>;
  runScheduledResourceOperationIteration: Mock<RunScheduledResourceOperationIteration>;
}

const mocks: WorkerServiceTestMocks = vi.hoisted(
  (): WorkerServiceTestMocks => ({
    buildReleaseImageFromSource: vi.fn<BuildReleaseImageFromSource>(),
    runScheduledResourceOperationIteration: vi.fn<RunScheduledResourceOperationIteration>(),
  }),
);

const testArtifactRegistry: WorkerArtifactRegistryConfig = {
  address: '127.0.0.1:5517',
  internalUrl: 'http://registry:5000',
  readCredentials: {
    password: 'read-password',
    username: 'reader',
  },
  writeCredentials: {
    password: 'write-password',
    username: 'writer',
  },
};

let temporaryDirectory: string;
let nodeAgentSocketPath: string;
let previousNodeAgentSocketPath: string;
let nodeRuntimeServers: Server[] = [];

vi.mock(
  '../src/services/worker-build.service',
  (): { buildReleaseImageFromSource: Mock<BuildReleaseImageFromSource> } => ({
    buildReleaseImageFromSource: mocks.buildReleaseImageFromSource,
  }),
);
vi.mock(
  '../src/services/worker-resource-operation-scheduler.service',
  (): { runScheduledResourceOperationIteration: Mock<RunScheduledResourceOperationIteration> } => ({
    runScheduledResourceOperationIteration: mocks.runScheduledResourceOperationIteration,
  }),
);

beforeEach(async (): Promise<void> => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'compartment-worker-node-'));
  nodeAgentSocketPath = join(temporaryDirectory, 'node', 'agent.sock');
  previousNodeAgentSocketPath = join(temporaryDirectory, 'node', 'previous-agent.sock');
  nodeRuntimeServers = [];
  mocks.runScheduledResourceOperationIteration.mockResolvedValue(false);
});

afterEach(async (): Promise<void> => {
  await Promise.all(nodeRuntimeServers.map(async (server: Server): Promise<void> => await closeServer(server)));
  await rm(temporaryDirectory, { force: true, recursive: true });
  mocks.buildReleaseImageFromSource.mockReset();
  mocks.runScheduledResourceOperationIteration.mockReset();
  vi.unstubAllGlobals();
});

describe('runWorkerIteration', (): void => {
  it('completes a claimed deployment after build and node deploy succeed', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload(),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/complete')) {
          return new Response(JSON.stringify(createWorkerCompleteDeploymentResponse()), { status: 200 });
        }
        if (url.endsWith('/internal/deployments/deploy')) {
          throw new Error('Node deploy requests must use the Unix socket requester.');
        }
        if (url.endsWith('/internal/deployments/fail')) {
          return new Response(
            JSON.stringify({
              deploymentId: 'dep_123',
              message: 'failed',
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    const nodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      nodeAgentSocketPath,
      (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
        expect(call.url).toBe('/internal/deployments/deploy');
        expect(call.body).toEqual(createNodeDeployRequest());

        return createNodeDeploySuccessResponse();
      },
    );

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(nodeRuntimeServer.calls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
    const runtimeStateBodies: Record<string, JsonValue>[] = fetchMock.mock.calls.flatMap(
      (call: FetchCall): Record<string, JsonValue>[] => {
        const url: string = readFetchUrl(call[0]);
        if (!url.endsWith('/internal/deployments/runtime-state')) {
          return [];
        }

        return [readJsonBody(call[1])];
      },
    );

    expect(runtimeStateBodies).toHaveLength(2);
    expect(runtimeStateBodies[0]).toMatchObject({
      deploymentId: 'dep_123',
      promotionStage: 'starting_candidate',
    });
    expect(readRuntimeEventMessages(fetchMock)).toEqual([
      'node deploy started',
      'runtime container started',
      'readiness passed',
      'switching active route',
      'deployment completed',
    ]);
  });

  it('reports runtime startup without a readiness check when the deployment disables readiness', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload({
                readiness: null,
              }),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/complete')) {
          return new Response(JSON.stringify(createWorkerCompleteDeploymentResponse()), { status: 200 });
        }
        if (url.endsWith('/internal/deployments/deploy')) {
          throw new Error('Node deploy requests must use the Unix socket requester.');
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    const nodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      nodeAgentSocketPath,
      (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
        expect(call.url).toBe('/internal/deployments/deploy');
        expect(call.body).toEqual(createNodeDeployRequest(undefined, null));

        return createNodeDeploySuccessResponse({
          startedAt: '2026-03-24T10:00:00.000Z',
        });
      },
    );

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(nodeRuntimeServer.calls).toHaveLength(1);
    expect(readRuntimeEventMessages(fetchMock)).toEqual([
      'node deploy started',
      'runtime container started',
      'switching active route',
      'deployment completed',
    ]);
  });

  it('runs a release command before starting the candidate container', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload({
                release: {
                  command: 'pnpm db:migrate',
                },
                runtimeEnv: {
                  DATABASE_URL: 'postgres://db/app',
                },
              }),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/complete')) {
          return new Response(JSON.stringify(createWorkerCompleteDeploymentResponse()), { status: 200 });
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    await startNodeRuntimeServer(nodeAgentSocketPath, (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
      if (call.url === '/internal/deployments/release') {
        expect(call.body).toEqual({
          deploymentId: 'dep_123',
          environmentId: 'env_123',
          environmentName: 'production',
          imageRef: 'sha256:image',
          projectId: 'prj_123',
          projectName: 'smoke-web',
          release: {
            command: 'pnpm db:migrate',
          },
          runtimeEnv: {
            DATABASE_URL: 'postgres://db/app',
          },
          serviceId: 'svc_123',
          serviceName: 'web',
        });

        return {
          body: {
            completedAt: '2026-03-23T11:59:59.000Z',
            logs: [
              {
                message: 'migrations complete',
                stream: 'stdout',
              },
            ],
            stderr: '',
            stdout: 'migrations complete',
          },
        };
      }
      if (call.url === '/internal/deployments/deploy') {
        return createNodeDeploySuccessResponse();
      }

      throw new Error(`Unexpected node runtime url: ${call.url}`);
    });

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(
      readRuntimeStatePromotions(fetchMock).filter((stage: JsonValue): boolean => typeof stage === 'string'),
    ).toEqual(['release', 'starting_candidate', 'switching_route']);
    expect(readRuntimeEventMessages(fetchMock)).toEqual([
      'release command started',
      'migrations complete',
      'release command completed',
      'node deploy started',
      'runtime container started',
      'readiness passed',
      'switching active route',
      'deployment completed',
    ]);
  });

  it('fails deployment without starting a candidate when release fails', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload({
                release: {
                  command: 'pnpm db:migrate',
                },
              }),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/fail')) {
          expect(readJsonBody(init)).toEqual({
            deploymentId: 'dep_123',
            imageRef: 'sha256:image',
            message: 'release command failed: missing table',
          });

          return new Response(
            JSON.stringify({
              deploymentId: 'dep_123',
              message: 'release command failed: missing table',
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    await startNodeRuntimeServer(nodeAgentSocketPath, (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
      if (call.url === '/internal/deployments/release') {
        return {
          body: createErrorResponse('unexpected', 'release command failed: missing table'),
          status: 500,
        };
      }
      if (call.url === '/internal/deployments/deploy') {
        throw new Error('Worker should not start a candidate after release failure.');
      }

      throw new Error(`Unexpected node runtime url: ${call.url}`);
    });

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(readRuntimeEventMessages(fetchMock)).toContain('release failed: release command failed: missing table');
  });

  it('drains the previous container on its owning node and persists drain ownership metadata', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload({
                previousDeployment: {
                  containerId: 'legacy_container_123',
                  deploymentId: 'dep_previous',
                  imageRef: 'sha256:legacy-image',
                  nodeId: 'node_previous',
                  nodeSocketPath: previousNodeAgentSocketPath,
                  upstreamHost: '127.0.0.1',
                  upstreamPort: 30999,
                },
              }),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/complete')) {
          expect(readJsonBody(init)).toMatchObject({
            deploymentId: 'dep_123',
            drain: {
              drainingContainerId: 'legacy_container_123',
              drainingDeploymentId: 'dep_previous',
              drainingNodeId: 'node_previous',
            },
            routeHost: 'smoke-web.localhost',
            upstreamPort: 31000,
          });

          return new Response(JSON.stringify(createWorkerCompleteDeploymentResponse()), { status: 200 });
        }
        if (url.endsWith('/internal/deployments/deploy') || url.endsWith('/internal/deployments/drain')) {
          throw new Error('Node runtime requests must use the Unix socket requester.');
        }
        if (url.endsWith('/internal/deployments/fail')) {
          return new Response(
            JSON.stringify({
              deploymentId: 'dep_123',
              message: 'failed',
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    const nodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      nodeAgentSocketPath,
      (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
        expect(call.url).toBe('/internal/deployments/deploy');
        expect(call.body).toEqual(
          createNodeDeployRequest({
            upstreamPort: 30999,
          }),
        );

        return createNodeDeploySuccessResponse();
      },
    );
    const previousNodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      previousNodeAgentSocketPath,
      (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
        expect(call.url).toBe('/internal/deployments/drain');
        expect(call.body).toMatchObject({
          containerId: 'legacy_container_123',
          deploymentId: 'dep_previous',
        });

        return {
          body: {
            acceptedAt: '2026-03-23T12:00:05.000Z',
          },
        };
      },
    );

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(nodeRuntimeServer.calls).toHaveLength(1);
    expect(previousNodeRuntimeServer.calls).toHaveLength(1);
  });

  it('keeps a switched deployment completed when the best-effort drain step fails', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload({
                previousDeployment: {
                  containerId: 'legacy_container_123',
                  deploymentId: 'dep_previous',
                  imageRef: 'sha256:legacy-image',
                  nodeId: 'node_previous',
                  nodeSocketPath: previousNodeAgentSocketPath,
                  upstreamHost: '127.0.0.1',
                  upstreamPort: 30999,
                },
              }),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/complete')) {
          return new Response(JSON.stringify(createWorkerCompleteDeploymentResponse()), { status: 200 });
        }
        if (url.endsWith('/internal/deployments/deploy') || url.endsWith('/internal/deployments/drain')) {
          throw new Error('Node runtime requests must use the Unix socket requester.');
        }
        if (url.endsWith('/internal/deployments/fail')) {
          return new Response(
            JSON.stringify({
              deploymentId: 'dep_123',
              message: 'failed',
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    const nodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      nodeAgentSocketPath,
      (): NodeRuntimeTestResponse => createNodeDeploySuccessResponse(),
    );
    const previousNodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      previousNodeAgentSocketPath,
      (): NodeRuntimeTestResponse => ({
        body: createErrorResponse('runtime_error', 'drain request failed'),
        status: 500,
      }),
    );

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(nodeRuntimeServer.calls).toHaveLength(1);
    expect(previousNodeRuntimeServer.calls).toHaveLength(1);
    expect(
      readRuntimeEventMessages(fetchMock).some((message: string): boolean => message.startsWith('drain failed:')),
    ).toBe(true);
    expect(readRuntimeEventMessages(fetchMock)).toContain('deployment completed');
    expect(
      fetchMock.mock.calls.some((call: FetchCall): boolean =>
        readFetchUrl(call[0]).endsWith('/internal/deployments/fail'),
      ),
    ).toBe(false);
  });

  it('does not report a second failure when completion returns project_archived', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload(),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/complete')) {
          return new Response(
            JSON.stringify(createErrorResponse('project_archived', 'The requested project is archived.')),
            { status: 409 },
          );
        }
        if (url.endsWith('/internal/deployments/deploy')) {
          throw new Error('Node deploy requests must use the Unix socket requester.');
        }
        if (url.endsWith('/internal/deployments/fail')) {
          throw new Error('Worker should not report fail after project_archived completion.');
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    const nodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      nodeAgentSocketPath,
      (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
        expect(call.url).toBe('/internal/deployments/deploy');
        expect(call.body).toEqual(createNodeDeployRequest());

        return createNodeDeploySuccessResponse();
      },
    );

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(nodeRuntimeServer.calls).toHaveLength(1);
  });

  it('does not report a second failure when completion returns edge_state_update_failed', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(
            JSON.stringify({
              deployment: createClaimedDeploymentPayload(),
            }),
            { status: 200 },
          );
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/complete')) {
          return new Response(
            JSON.stringify(createErrorResponse('edge_state_update_failed', 'The edge state could not be updated.')),
            { status: 502 },
          );
        }
        if (url.endsWith('/internal/deployments/deploy')) {
          throw new Error('Node deploy requests must use the Unix socket requester.');
        }
        if (url.endsWith('/internal/deployments/fail')) {
          throw new Error('Worker should not report fail after edge_state_update_failed completion.');
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce('sha256:image');
    const nodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      nodeAgentSocketPath,
      (call: NodeRuntimeRequestCall): NodeRuntimeTestResponse => {
        expect(call.url).toBe('/internal/deployments/deploy');
        expect(call.body).toEqual(createNodeDeployRequest());

        return createNodeDeploySuccessResponse();
      },
    );

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );
    expect(claimedWork).toBe(true);
    expect(nodeRuntimeServer.calls).toHaveLength(1);
  });

  it('reports the durable image ref when deployment fails after build completion', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(JSON.stringify({ deployment: createClaimedDeploymentPayload() }), { status: 200 });
        }
        if (
          url.endsWith('/internal/deployments/runtime-state') ||
          url.endsWith('/internal/deployments/runtime-events')
        ) {
          return new Response(init?.body ?? '{}', { status: 200 });
        }
        if (url.endsWith('/internal/deployments/deploy')) {
          throw new Error('Node deploy requests must use the Unix socket requester.');
        }
        if (url.endsWith('/internal/deployments/fail')) {
          const failureMessage: string = 'missing env';
          expect(readJsonBody(init)).toEqual({
            deploymentId: 'dep_123',
            imageRef: '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123@sha256:image',
            message: failureMessage,
          });

          return new Response(
            JSON.stringify({
              deploymentId: 'dep_123',
              message: failureMessage,
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockResolvedValueOnce(
      '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123@sha256:image',
    );
    const nodeRuntimeServer: NodeRuntimeTestServer = await startNodeRuntimeServer(
      nodeAgentSocketPath,
      (): NodeRuntimeTestResponse => ({
        body: createErrorResponse(
          'unexpected',
          'runtime readiness failed: process exited\nLast logs:\n[stdout] booting\n[stderr] missing env',
        ),
        status: 500,
      }),
    );

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
    expect(nodeRuntimeServer.calls).toHaveLength(1);
    expect(readRuntimeEventMessages(fetchMock)).toContain('runtime deployment failed: missing env');
  });

  it('reports an unknown deployment failure when build throws a non-error value', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        const url: string = readFetchUrl(input);
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');
        if (url.endsWith(workerClaimNextGitSourceResolutionTaskPathname)) {
          return createEmptyGitSourceResolutionTaskClaimResponse();
        }
        if (url.endsWith(workerClaimNextDeploymentPathname)) {
          return new Response(JSON.stringify({ deployment: createClaimedDeploymentPayload() }), { status: 200 });
        }
        if (url.endsWith('/internal/deployments/fail')) {
          expect(readJsonBody(init)).toEqual({
            deploymentId: 'dep_123',
            message: 'Unknown deployment failure.',
          });

          return new Response(
            JSON.stringify({
              deploymentId: 'dep_123',
              message: 'Unknown deployment failure.',
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch url: ${url}`);
      });
    vi.stubGlobal('fetch', fetchMock);
    mocks.buildReleaseImageFromSource.mockRejectedValueOnce('build failed');

    const claimedWork: boolean = await runWorkerIteration(
      'http://127.0.0.1:9443',
      'worker-secret',
      'compartment-e2e',
      testArtifactRegistry,
    );

    expect(claimedWork).toBe(true);
  });
});

function createClaimedDeploymentPayload(input: Partial<WorkerClaimedDeployment> = {}): WorkerClaimedDeployment {
  return createClaimedDeploymentPayloadForNode(nodeAgentSocketPath, input);
}

async function startNodeRuntimeServer(
  socketPath: string,
  handler: NodeRuntimeRouteHandler,
): Promise<NodeRuntimeTestServer> {
  return await startNodeRuntimeServerWithRegistry(socketPath, handler, nodeRuntimeServers);
}
