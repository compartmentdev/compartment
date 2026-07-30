import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  WorkerClaimDeploymentResponse,
  WorkerClaimedDeployment,
  WorkerFailDeploymentRequest,
  WorkerRunNextScheduledResourceOperationResponse,
} from '@compartment/contracts';
import type { CompartmentBinaryRequester, CompartmentRawRequester, CompartmentRequester } from '@compartment/sdk';
import pino, { type Logger } from 'pino';
import { runWorkerIteration as runWorkerIterationWithKek } from '../src/services/worker.service';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import type { WorkerDeploymentEventContext } from '../src/services/worker-deployment-event.types';
import { testTenantSecretsKek } from './tenant-secret-test.fixtures';

type AppendDeploymentStepEventSafely = (
  context: WorkerDeploymentEventContext,
  stepKey: string,
  status: string,
  message: string,
) => Promise<void>;
type BuildReleaseImageFromSource = (
  request: CompartmentRequester,
  archiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  artifactRegistry: WorkerArtifactRegistryConfig,
  tenantSecretsKek: typeof testTenantSecretsKek,
) => Promise<string>;

type ClaimNextDeployment = (request: CompartmentRequester) => Promise<WorkerClaimDeploymentResponse>;
type FailDeployment = (
  request: CompartmentRequester,
  body: WorkerFailDeploymentRequest,
) => Promise<WorkerFailDeploymentRequest>;
type HandoffBuiltDeploymentToKube = (
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
) => Promise<void>;
type RunGitSourceResolutionIteration = (
  request: CompartmentRequester,
  rawRequest: CompartmentRawRequester,
) => Promise<boolean>;
type RunRequesterIteration = (request: CompartmentRequester) => Promise<boolean>;
type RunNextScheduledResourceOperation = (
  request: CompartmentRequester,
) => Promise<WorkerRunNextScheduledResourceOperationResponse>;

interface WorkerServiceMocks {
  archiveRequest: CompartmentBinaryRequester;
  appendDeploymentStepEventSafely: Mock<AppendDeploymentStepEventSafely>;
  buildReleaseImageFromSource: Mock<BuildReleaseImageFromSource>;
  claimNextDeployment: Mock<ClaimNextDeployment>;
  failDeployment: Mock<FailDeployment>;
  handoffBuiltDeploymentToKube: Mock<HandoffBuiltDeploymentToKube>;
  rawRequest: CompartmentRawRequester;
  request: CompartmentRequester;
  runGitSourceResolutionIteration: Mock<RunGitSourceResolutionIteration>;
  runGitSourceSyncIteration: Mock<RunRequesterIteration>;
  runNextScheduledResourceOperation: Mock<RunNextScheduledResourceOperation>;
}

const mocks: WorkerServiceMocks = vi.hoisted(
  (): WorkerServiceMocks => ({
    archiveRequest: vi.fn() as CompartmentBinaryRequester,
    appendDeploymentStepEventSafely: vi.fn<AppendDeploymentStepEventSafely>(),
    buildReleaseImageFromSource: vi.fn<BuildReleaseImageFromSource>(),
    claimNextDeployment: vi.fn<ClaimNextDeployment>(),
    failDeployment: vi.fn<FailDeployment>(),
    handoffBuiltDeploymentToKube: vi.fn<HandoffBuiltDeploymentToKube>(),
    rawRequest: vi.fn() as CompartmentRawRequester,
    request: vi.fn() as CompartmentRequester,
    runGitSourceResolutionIteration: vi.fn<RunGitSourceResolutionIteration>(),
    runGitSourceSyncIteration: vi.fn<RunRequesterIteration>(),
    runNextScheduledResourceOperation: vi.fn<RunNextScheduledResourceOperation>(),
  }),
);

const logger: Logger<never, boolean> = pino({ enabled: false });

vi.mock(
  '@compartment/sdk',
  (): {
    claimNextDeployment: Mock<ClaimNextDeployment>;
    createCompartmentBinaryRequester: () => CompartmentBinaryRequester;
    createCompartmentRawRequester: () => CompartmentRawRequester;
    createCompartmentRequester: () => CompartmentRequester;
    failDeployment: Mock<FailDeployment>;
    isCompartmentRequestError: (error: Error | null | undefined) => boolean;
    runNextScheduledResourceOperation: Mock<RunNextScheduledResourceOperation>;
  } => ({
    claimNextDeployment: mocks.claimNextDeployment,
    createCompartmentBinaryRequester: (): CompartmentBinaryRequester => mocks.archiveRequest,
    createCompartmentRawRequester: (): CompartmentRawRequester => mocks.rawRequest,
    createCompartmentRequester: (): CompartmentRequester => mocks.request,
    failDeployment: mocks.failDeployment,
    isCompartmentRequestError: (error: Error | null | undefined): boolean => error?.name === 'CompartmentRequestError',
    runNextScheduledResourceOperation: mocks.runNextScheduledResourceOperation,
  }),
);

vi.mock(
  '../src/services/worker-build.service',
  (): { buildReleaseImageFromSource: Mock<BuildReleaseImageFromSource> } => ({
    buildReleaseImageFromSource: mocks.buildReleaseImageFromSource,
  }),
);

vi.mock(
  '../src/services/worker-deployment-event.service',
  (): {
    appendDeploymentStepEventSafely: Mock<AppendDeploymentStepEventSafely>;
    buildDeploymentEventContext: (
      inputRequest: CompartmentRequester,
      deployment: WorkerClaimedDeployment,
    ) => WorkerDeploymentEventContext;
  } => ({
    appendDeploymentStepEventSafely: mocks.appendDeploymentStepEventSafely,
    buildDeploymentEventContext: (
      inputRequest: CompartmentRequester,
      deployment: WorkerClaimedDeployment,
    ): WorkerDeploymentEventContext => ({
      deploymentId: deployment.deploymentId,
      deploymentRunId: deployment.deploymentRunId,
      request: inputRequest,
    }),
  }),
);

vi.mock(
  '../src/services/worker-git-source-resolution.service',
  (): { runGitSourceResolutionIteration: Mock<RunGitSourceResolutionIteration> } => ({
    runGitSourceResolutionIteration: mocks.runGitSourceResolutionIteration,
  }),
);

vi.mock(
  '../src/services/worker-git-source-sync.service',
  (): { runGitSourceSyncIteration: Mock<RunRequesterIteration> } => ({
    runGitSourceSyncIteration: mocks.runGitSourceSyncIteration,
  }),
);

vi.mock(
  '../src/services/worker-kube-deployment-handoff.service',
  (): { handoffBuiltDeploymentToKube: Mock<HandoffBuiltDeploymentToKube> } => ({
    handoffBuiltDeploymentToKube: mocks.handoffBuiltDeploymentToKube,
  }),
);

async function runWorkerIteration(
  apiUrl: string,
  internalToken: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  iterationLogger: Logger<never, boolean>,
): Promise<boolean> {
  return await runWorkerIterationWithKek(
    apiUrl,
    internalToken,
    artifactRegistry,
    iterationLogger,
    testTenantSecretsKek,
  );
}

describe('runWorkerIteration', (): void => {
  beforeEach((): void => {
    mocks.runGitSourceResolutionIteration.mockResolvedValue(false);
    mocks.runNextScheduledResourceOperation.mockResolvedValue({
      backupId: null,
      cleanedBackups: [],
      operationType: null,
      ran: false,
      recordedFailure: false,
      resourceName: null,
    });
    mocks.runGitSourceSyncIteration.mockResolvedValue(false);
    mocks.claimNextDeployment.mockResolvedValue({ deployment: null });
    mocks.buildReleaseImageFromSource.mockResolvedValue(`registry.example/app@sha256:${'a'.repeat(64)}`);
    mocks.handoffBuiltDeploymentToKube.mockResolvedValue(undefined);
    mocks.appendDeploymentStepEventSafely.mockResolvedValue(undefined);
    mocks.failDeployment.mockImplementation(
      async (_request: CompartmentRequester, body: WorkerFailDeploymentRequest): Promise<WorkerFailDeploymentRequest> =>
        await Promise.resolve(body),
    );
  });

  afterEach((): void => {
    vi.clearAllMocks();
  });

  it('builds a claimed deployment and hands the digest-pinned image to Kubernetes', async (): Promise<void> => {
    const deployment: WorkerClaimedDeployment = createClaimedDeployment();
    mocks.claimNextDeployment.mockResolvedValueOnce({ deployment });

    await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

    expect(mocks.buildReleaseImageFromSource).toHaveBeenCalledWith(
      mocks.request,
      mocks.archiveRequest,
      deployment,
      artifactRegistry,
      testTenantSecretsKek,
    );
    expect(mocks.handoffBuiltDeploymentToKube).toHaveBeenCalledWith(
      mocks.request,
      deployment,
      `registry.example/app@sha256:${'a'.repeat(64)}`,
    );
    expect(mocks.failDeployment).not.toHaveBeenCalled();
  });

  it('reports a post-build Kubernetes handoff failure with the durable image ref', async (): Promise<void> => {
    mocks.claimNextDeployment.mockResolvedValueOnce({ deployment: createClaimedDeployment() });
    mocks.handoffBuiltDeploymentToKube.mockRejectedValueOnce(new Error('namespace provisioning failed'));

    await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

    expect(mocks.failDeployment).toHaveBeenCalledWith(mocks.request, {
      deploymentId: 'dep_123',
      imageRef: `registry.example/app@sha256:${'a'.repeat(64)}`,
      message: 'namespace provisioning failed',
    });
  });

  it.each(['project_archived', 'edge_state_update_failed'])(
    'does not overwrite the terminal API result for %s',
    async (code: string): Promise<void> => {
      mocks.claimNextDeployment.mockResolvedValueOnce({ deployment: createClaimedDeployment() });
      mocks.handoffBuiltDeploymentToKube.mockRejectedValueOnce(createCompartmentRequestError(code));

      await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

      expect(mocks.failDeployment).not.toHaveBeenCalled();
      expect(mocks.appendDeploymentStepEventSafely).not.toHaveBeenCalled();
    },
  );

  it('reports an unknown failure when a dependency rejects with a non-Error value', async (): Promise<void> => {
    mocks.claimNextDeployment.mockResolvedValueOnce({ deployment: createClaimedDeployment() });
    mocks.buildReleaseImageFromSource.mockRejectedValueOnce('build failed');

    await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

    expect(mocks.failDeployment).toHaveBeenCalledWith(mocks.request, {
      deploymentId: 'dep_123',
      message: 'Unknown deployment failure.',
    });
  });

  it('continues to later queues when no deployment is claimable', async (): Promise<void> => {
    mocks.runGitSourceSyncIteration.mockResolvedValueOnce(true);

    await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

    expect(mocks.claimNextDeployment).toHaveBeenCalledWith(mocks.request);
    expect(mocks.runGitSourceSyncIteration).toHaveBeenCalledWith(mocks.request);
  });

  it('does not claim a deployment while an earlier queue has work', async (): Promise<void> => {
    mocks.runGitSourceResolutionIteration.mockResolvedValueOnce(true);

    await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

    expect(mocks.claimNextDeployment).not.toHaveBeenCalled();
  });

  it('continues to deployment work when the scheduled resource phase throws', async (): Promise<void> => {
    const deployment: WorkerClaimedDeployment = createClaimedDeployment();
    vi.spyOn(logger, 'error');
    mocks.runNextScheduledResourceOperation.mockRejectedValueOnce(new Error('retention delete failed'));
    mocks.claimNextDeployment.mockResolvedValueOnce({ deployment });

    await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

    expect(logger.error).toHaveBeenCalledOnce();
    expect(mocks.buildReleaseImageFromSource).toHaveBeenCalledWith(
      mocks.request,
      mocks.archiveRequest,
      deployment,
      artifactRegistry,
      testTenantSecretsKek,
    );
  });

  it('continues to deployment work after the API records a scheduled operation failure', async (): Promise<void> => {
    const deployment: WorkerClaimedDeployment = createClaimedDeployment();
    mocks.runNextScheduledResourceOperation.mockResolvedValueOnce({
      backupId: null,
      cleanedBackups: [],
      operationType: 'backup',
      ran: true,
      recordedFailure: true,
      resourceName: 'postgres',
    });
    mocks.claimNextDeployment.mockResolvedValueOnce({ deployment });

    await expect(runWorkerIteration('http://api', 'worker-secret', artifactRegistry, logger)).resolves.toBe(true);

    expect(mocks.buildReleaseImageFromSource).toHaveBeenCalledWith(
      mocks.request,
      mocks.archiveRequest,
      deployment,
      artifactRegistry,
      testTenantSecretsKek,
    );
  });
});

const artifactRegistry: WorkerArtifactRegistryConfig = {
  address: 'registry.example',
  credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
  internalAddress: 'registry:5000',
  internalUrl: 'http://registry:5000',
};

function createClaimedDeployment(): WorkerClaimedDeployment {
  return {
    artifact: {
      id: 'art_123',
      imageRef: null,
      sourceDigest: 'sha256:source',
    },
    buildEnv: {},
    deploymentId: 'dep_123',
    deploymentRunId: 'drn_123',
    environmentId: 'env_123',
    environmentName: 'production',
    projectId: 'prj_123',
    projectName: 'smoke-web',
    requiresSourceRoutesFile: false,
    routeHost: 'smoke-web.localhost',
    run: {},
    service: {
      build: {
        env: [],
        include: [],
        packages: { build: [], runtime: [] },
        strategy: 'auto',
      },
      id: 'svc_123',
      kind: 'web',
      name: 'web',
      path: '.',
    },
  };
}

function createCompartmentRequestError(code: string): Error & { code: string; statusCode: number } {
  const error: Error & { code: string; statusCode: number } = Object.assign(new Error(code), {
    code,
    statusCode: 409,
  });
  error.name = 'CompartmentRequestError';
  return error;
}
