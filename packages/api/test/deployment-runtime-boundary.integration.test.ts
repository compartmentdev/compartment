import type { LightMyRequestResponse } from 'fastify';
import {
  deployResponseSchema,
  errorResponseSchema,
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type RuntimePreviousDeployment,
  type WorkerClaimedDeployment,
  workerAppendDeploymentEventPathname,
  workerUpdateDeploymentRuntimePathname,
} from '@compartment/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  app,
  buildDrainState,
  closeRuntimeBoundaryApp,
  completeDeploymentForWorker,
  deployAndActivateCurrentService,
  drainDeadlineAt,
  ensureRuntimeBoundaryDatabase,
  readActiveDeploymentInspect,
  readStoredRuntimeState,
  requirePreviousDeployment,
  resetRuntimeBoundaryDatabase,
  stubRuntimeInspectResponse,
  updateRuntimeStateForWorker,
} from './deployment-runtime-boundary.integration.harness';
import {
  claimNextQueuedDeployment,
  injectDeployRequest,
  installCompartment,
  registerLocalNode,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
} from './api-integration.harness';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

interface TestErrorDetails {
  code: string;
  message: string;
}

interface TestErrorResponse {
  error: TestErrorDetails;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

const deploymentRuntimeBoundaryTimeoutMs: number = 20_000;

describe('deployment runtime boundary integration', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRuntimeBoundaryDatabase();
  });

  beforeEach(async (): Promise<void> => {
    await resetRuntimeBoundaryDatabase();
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await closeRuntimeBoundaryApp();
  });

  it('returns a worker contract error for unknown runtime-state deployments', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-runtime-control-token',
      },
      method: 'POST',
      payload: {
        deploymentId: 'dep_missing',
        promotionStage: 'active',
      },
      url: workerUpdateDeploymentRuntimePathname,
    });

    expect(response.statusCode).toBe(404);
    const payload: TestErrorResponse = errorResponseSchema.parse(response.json());
    expect(payload.error.code).toBe('deployment_not_found');
  });

  it('returns a worker contract error for unknown runtime event deployment runs', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-runtime-control-token',
      },
      method: 'POST',
      payload: {
        deploymentId: 'dep_missing',
        deploymentRunId: 'drn_missing',
        level: 'info',
        message: 'runtime event',
        stepKey: 'starting_candidate',
        stream: 'compartment',
      },
      url: workerAppendDeploymentEventPathname,
    });

    expect(response.statusCode).toBe(404);
    const payload: TestErrorResponse = errorResponseSchema.parse(response.json());
    expect(payload.error.code).toBe('deployment_not_found');
  });

  it(
    'preserves and clears drain state through worker completion and runtime-state updates',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      const firstDeployment: DeploymentSummary = await deployAndActivateCurrentService(installPayload);
      const secondDeployResponse: LightMyRequestResponse = await injectDeployRequest(
        app,
        installPayload.sessionToken,
        'acme-dev',
      );
      expect(secondDeployResponse.statusCode).toBe(200);
      const secondDeployPayload: DeployResponse = deployResponseSchema.parse(secondDeployResponse.json());
      const secondDeployment: DeploymentSummary = requireDeployResponseDeployment(secondDeployPayload);
      const secondClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      const previousDeployment: RuntimePreviousDeployment = requirePreviousDeployment(secondClaimedDeployment);

      await completeDeploymentForWorker({
        containerId: 'container_candidate_123',
        deploymentId: secondDeployment.id,
        drain: buildDrainState(previousDeployment),
        imageRef: 'sha256:image-next',
        routeHost: secondClaimedDeployment.routeHost,
        upstreamHost: '127.0.0.1',
        upstreamPort: 32000,
      });

      expect(await readStoredRuntimeState(secondDeployment.id)).toEqual({
        drainDeadlineAt: new Date(drainDeadlineAt),
        drainingContainerId: previousDeployment.containerId,
        drainingDeploymentId: firstDeployment.id,
        drainingNodeId: previousDeployment.nodeId,
        promotionStage: 'draining_previous',
        upstreamHost: '127.0.0.1',
        upstreamPort: 32000,
      });

      await updateRuntimeStateForWorker({
        deploymentId: secondDeployment.id,
        promotionStage: 'switching_route',
        upstreamHost: '127.0.0.1',
        upstreamPort: 32001,
      });

      expect(await readStoredRuntimeState(secondDeployment.id)).toEqual({
        drainDeadlineAt: new Date(drainDeadlineAt),
        drainingContainerId: previousDeployment.containerId,
        drainingDeploymentId: firstDeployment.id,
        drainingNodeId: previousDeployment.nodeId,
        promotionStage: 'switching_route',
        upstreamHost: '127.0.0.1',
        upstreamPort: 32001,
      });

      stubRuntimeInspectResponse();
      expect(await readActiveDeploymentInspect(installPayload)).toMatchObject({
        drain: {
          containerId: previousDeployment.containerId,
          deadlineAt: drainDeadlineAt,
        },
        id: secondDeployment.id,
        promotionStage: 'switching_route',
        upstreamPort: 32001,
      });

      await updateRuntimeStateForWorker({
        deploymentId: secondDeployment.id,
        drain: null,
        promotionStage: 'active',
        upstreamHost: '127.0.0.1',
        upstreamPort: 32001,
      });

      expect(await readStoredRuntimeState(secondDeployment.id)).toEqual({
        drainDeadlineAt: null,
        drainingContainerId: null,
        drainingDeploymentId: null,
        drainingNodeId: null,
        promotionStage: 'active',
        upstreamHost: '127.0.0.1',
        upstreamPort: 32001,
      });
      expect(await readActiveDeploymentInspect(installPayload)).toMatchObject({
        drain: null,
        id: secondDeployment.id,
        promotionStage: 'active',
        upstreamPort: 32001,
      });
    },
    deploymentRuntimeBoundaryTimeoutMs,
  );
});
