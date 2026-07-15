import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  DeployResponse,
  DeploymentReadEnvironmentSummary,
  DeploymentReadProjectSummary,
  DeploymentReadSummary,
  DeploymentStatusResponse,
} from '@compartment/contracts';
import type * as CompartmentSdk from '@compartment/sdk';
import type { CompartmentRequester, getDeploymentStatus } from '@compartment/sdk';
import { waitForDeploymentOperationCompletion } from '../src/services/deployment-operation-runner.service';
import {
  createDeploymentReadEnvironmentSummaryFixture,
  createDeploymentReadProjectSummaryFixture,
  createDeploymentStatusResponseFixture,
  createDeployResponseFixture,
  createEnvironmentSummaryFixture,
  createHistoricalDeploymentReadSummaryFixture,
  createProjectSummaryFixture,
} from './cli-test.fixtures';

type GetDeploymentStatus = typeof getDeploymentStatus;
type ImportCompartmentSdkOriginal = () => Promise<typeof CompartmentSdk>;

interface DeploymentOperationRunnerMocks {
  getDeploymentStatus: Mock<GetDeploymentStatus>;
}

interface DeploymentStatusFixtureScopeInput {
  environment?: Partial<DeploymentReadEnvironmentSummary> | undefined;
  project?: Partial<DeploymentReadProjectSummary> | undefined;
}

interface TransportFailureCause {
  code: string;
}

interface TransportFailureError extends Error {
  cause: {
    cause: TransportFailureCause;
  };
}

const mocks: DeploymentOperationRunnerMocks = vi.hoisted(
  (): DeploymentOperationRunnerMocks => ({
    getDeploymentStatus: vi.fn<GetDeploymentStatus>(),
  }),
);

vi.mock('@compartment/sdk', async (importOriginal: ImportCompartmentSdkOriginal): Promise<typeof CompartmentSdk> => {
  const actual: typeof CompartmentSdk = await importOriginal();
  return {
    ...actual,
    getDeploymentStatus: mocks.getDeploymentStatus,
  };
});

describe('deployment operation runner service', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('fails fast when deploy does not return any deployments to poll', async (): Promise<void> => {
    await expect(
      waitForDeploymentOperationCompletion(
        createRequester(),
        {
          deploymentRunId: 'drn_123',
          deployments: [],
          environment: createEnvironmentSummaryFixture({ name: 'preview' }),
          project: createProjectSummaryFixture(),
          resources: [],
        },
        undefined,
      ),
    ).rejects.toThrow('Deploy did not return any deployments.');
  });

  it('fails when polling cannot find a deployment returned by the deploy call', async (): Promise<void> => {
    const request: CompartmentRequester = createRequester();
    mocks.getDeploymentStatus.mockResolvedValueOnce({
      activeDeployments: [],
      deployments: [],
      environment: createDeploymentReadEnvironmentSummaryFixture({ name: 'preview' }),
      project: createDeploymentReadProjectSummaryFixture(),
    });

    await expect(waitForDeploymentOperationCompletion(request, createDeployResponse(), undefined)).rejects.toThrow(
      'Deployment dep_123 was not found while polling.',
    );
  });

  it('keeps polling until the deployment becomes fully active', async (): Promise<void> => {
    vi.useFakeTimers();
    mocks.getDeploymentStatus
      .mockResolvedValueOnce(createRunningDeploymentStatusResponse())
      .mockResolvedValueOnce(createReleasingDeploymentStatusResponse())
      .mockResolvedValueOnce(createSucceededDeploymentStatusResponse());

    const completionPromise: Promise<DeploymentStatusResponse> = waitForDeploymentOperationCompletion(
      createRequester(),
      createDeployResponse(),
      undefined,
    );

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(completionPromise).resolves.toEqual(createSucceededDeploymentStatusResponse());
    expect(mocks.getDeploymentStatus).toHaveBeenCalledTimes(3);
  });

  it('retries transient transport failures while polling deployments', async (): Promise<void> => {
    vi.useFakeTimers();
    mocks.getDeploymentStatus
      .mockRejectedValueOnce(createTransportFailure('ECONNREFUSED'))
      .mockResolvedValueOnce(createSucceededDeploymentStatusResponse());

    const completionPromise: Promise<DeploymentStatusResponse> = waitForDeploymentOperationCompletion(
      createRequester(),
      createDeployResponse(),
      undefined,
    );
    const completionAssertion: Promise<void> = expect(completionPromise).resolves.toEqual(
      createSucceededDeploymentStatusResponse(),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await completionAssertion;
  });

  it('fails after repeated transient transport failures while polling deployments', async (): Promise<void> => {
    vi.useFakeTimers();
    mocks.getDeploymentStatus.mockRejectedValue(createTransportFailure('ECONNREFUSED'));

    const completionPromise: Promise<DeploymentStatusResponse> = waitForDeploymentOperationCompletion(
      createRequester(),
      createDeployResponse(),
      undefined,
    );
    const completionAssertion: Promise<void> = expect(completionPromise).rejects.toThrow(
      'GET /v1/deployments/status failed: connection refused.',
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await completionAssertion;
  });

  it('treats a stopped deployment as terminal instead of polling forever', async (): Promise<void> => {
    vi.useFakeTimers();
    const stoppedStatus: DeploymentStatusResponse = createStoppedDeploymentStatusResponse();
    mocks.getDeploymentStatus.mockResolvedValueOnce(stoppedStatus);

    await expect(
      waitForDeploymentOperationCompletion(createRequester(), createDeployResponse(), undefined),
    ).resolves.toEqual(stoppedStatus);
    expect(mocks.getDeploymentStatus).toHaveBeenCalledTimes(1);
  });

  it('treats a rolled-back deployment as terminal instead of polling forever', async (): Promise<void> => {
    vi.useFakeTimers();
    const rolledBackStatus: DeploymentStatusResponse = createRolledBackDeploymentStatusResponse();
    mocks.getDeploymentStatus.mockResolvedValueOnce(rolledBackStatus);

    await expect(
      waitForDeploymentOperationCompletion(createRequester(), createDeployResponse(), undefined),
    ).resolves.toEqual(rolledBackStatus);
    expect(mocks.getDeploymentStatus).toHaveBeenCalledTimes(1);
  });
});

function createRequester(): CompartmentRequester {
  return vi.fn() as CompartmentRequester;
}

function createTransportFailure(code: string): TransportFailureError {
  return Object.assign(new Error('GET /v1/deployments/status failed: connection refused.'), {
    cause: {
      cause: {
        code,
      },
    },
  });
}

function createDeployResponse(): DeployResponse {
  return createDeployResponseFixture({
    deployment: {
      createdAt: '2026-03-25T10:00:00.000Z',
      health: 'healthy',
      id: 'dep_123',
      operation: {
        completedAt: null,
        createdAt: '2026-03-25T10:00:00.000Z',
        id: 'op_123',
        status: 'queued',
        targetId: 'dep_123',
        targetType: 'deployment',
        type: 'deployment.create',
      },
      serviceName: 'web',
      status: 'queued',
    },
    environment: {
      createdAt: '2026-03-25T10:00:00.000Z',
      name: 'preview',
      updatedAt: '2026-03-25T10:00:00.000Z',
    },
  });
}

function createDeploymentReadSummary(): DeploymentReadSummary {
  return createHistoricalDeploymentReadSummaryFixture({
    completedAt: null,
    createdAt: '2026-03-25T10:00:00.000Z',
    health: 'pending',
    operation: {
      completedAt: null,
      createdAt: '2026-03-25T10:00:00.000Z',
      status: 'queued',
      type: 'deployment.create',
    },
    promotionStage: 'building',
    routeUrl: null,
    serviceName: 'web',
    status: 'queued',
  });
}

function createRunningDeploymentStatusResponse(): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = {
    ...createDeploymentReadSummary(),
    health: 'pending',
    operation: {
      ...createDeploymentReadSummary().operation,
      status: 'running',
    },
    status: 'running',
  };

  return createDeploymentStatusResponse(deployment, {
    environment: { name: 'preview' },
  });
}

function createSucceededDeploymentStatusResponse(): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = {
    ...createDeploymentReadSummary(),
    completedAt: '2026-03-25T10:01:00.000Z',
    health: 'healthy',
    isActive: true,
    operation: {
      ...createDeploymentReadSummary().operation,
      completedAt: '2026-03-25T10:01:00.000Z',
      status: 'succeeded',
    },
    promotionStage: 'active',
    routeUrl: 'http://service.localhost',
    status: 'succeeded',
  };

  return createDeploymentStatusResponse(deployment, {
    environment: { name: 'preview' },
    project: createDeploymentReadProjectSummaryFixture(),
  });
}

function createReleasingDeploymentStatusResponse(): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = {
    ...createDeploymentReadSummary(),
    completedAt: '2026-03-25T10:01:00.000Z',
    health: 'healthy',
    isActive: true,
    operation: {
      ...createDeploymentReadSummary().operation,
      completedAt: '2026-03-25T10:01:00.000Z',
      status: 'succeeded',
    },
    promotionStage: 'release',
    routeUrl: 'https://smoke-web.preview.acme.dev',
    status: 'succeeded',
  };

  return createDeploymentStatusResponse(deployment, {
    environment: { name: 'preview' },
    project: createDeploymentReadProjectSummaryFixture(),
  });
}

function createStoppedDeploymentStatusResponse(): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = {
    ...createDeploymentReadSummary(),
    completedAt: '2026-03-25T10:01:00.000Z',
    health: 'healthy',
    operation: {
      ...createDeploymentReadSummary().operation,
      completedAt: '2026-03-25T10:01:00.000Z',
      status: 'succeeded',
    },
    promotionStage: 'stopped',
    status: 'stopped',
  };

  return createDeploymentStatusResponse(deployment, {
    environment: { name: 'preview' },
    project: createDeploymentReadProjectSummaryFixture(),
  });
}

function createRolledBackDeploymentStatusResponse(): DeploymentStatusResponse {
  const deployment: DeploymentReadSummary = {
    ...createDeploymentReadSummary(),
    completedAt: '2026-03-25T10:01:00.000Z',
    health: 'healthy',
    operation: {
      ...createDeploymentReadSummary().operation,
      completedAt: '2026-03-25T10:01:00.000Z',
      status: 'succeeded',
    },
    promotionStage: 'rolled_back',
    status: 'succeeded',
  };

  return createDeploymentStatusResponse(deployment, {
    environment: { name: 'preview' },
    project: createDeploymentReadProjectSummaryFixture(),
  });
}

function createDeploymentStatusResponse(
  deployment: DeploymentReadSummary,
  input: DeploymentStatusFixtureScopeInput = {},
): DeploymentStatusResponse {
  return createDeploymentStatusResponseFixture({
    activeDeployments: deployment.isActive ? [deployment] : [],
    deployments: [deployment],
    environment: input.environment,
    project: input.project,
  });
}
