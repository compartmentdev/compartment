import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResolvedCompartmentServiceRunConfig, WorkerClaimedDeployment } from '@compartment/contracts';
import type { KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { WorkerConfig } from '../src/config';
import { buildReleaseImageFromSource } from '../src/services/worker-build.service';
import type { RunWorkerBuildJobInput } from '../src/services/worker-build-job.types';
import { createWorkerTestConfig } from './worker-config-test.fixtures';

type RunWorkerBuildJob = (
  runtime: KubeRuntime,
  config: object,
  input: RunWorkerBuildJobInput,
) => Promise<{
  imageRef: string;
  pushed: boolean;
}>;

const mocks: {
  runWorkerBuildJob: Mock<RunWorkerBuildJob>;
} = vi.hoisted(
  (): {
    runWorkerBuildJob: Mock<RunWorkerBuildJob>;
  } => ({
    runWorkerBuildJob: vi.fn<RunWorkerBuildJob>(),
  }),
);

vi.mock('../src/services/worker-build-job.service', (): { runWorkerBuildJob: Mock<RunWorkerBuildJob> } => ({
  runWorkerBuildJob: mocks.runWorkerBuildJob,
}));

afterEach((): void => {
  vi.clearAllMocks();
});

describe('buildReleaseImageFromSource', (): void => {
  it('rejects a build Job result that is not digest pinned', async (): Promise<void> => {
    mocks.runWorkerBuildJob.mockResolvedValueOnce({ imageRef: 'registry:5000/web:tag', pushed: true });

    await expect(
      buildReleaseImageFromSource(
        vi.fn() as CompartmentRequester,
        createClaimedDeployment(),
        createWorkerConfig(),
        {} as KubeRuntime,
      ),
    ).rejects.toThrow('return a digest-pinned BuildKit push result');
  });
});

function createWorkerConfig(): WorkerConfig {
  return createWorkerTestConfig({ apiUrl: 'http://api:39444', runtimeControlToken: 'runtime-control-token' });
}

function createClaimedDeployment(input: Partial<WorkerClaimedDeployment> = {}): WorkerClaimedDeployment {
  return {
    artifact: input.artifact ?? { id: 'art_123', imageRef: null, sourceDigest: 'sha256:source' },
    buildEnv: {},
    deploymentId: 'dep_123',
    deploymentRunId: 'drn_123',
    environmentId: 'env_123',
    environmentName: 'production',
    projectId: 'prj_123',
    projectName: 'smoke-web',
    requiresSourceRoutesFile: false,
    routeHost: 'smoke-web.localhost',
    run: createRun(),
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
    ...input,
  };
}

function createRun(): ResolvedCompartmentServiceRunConfig {
  return {};
}
