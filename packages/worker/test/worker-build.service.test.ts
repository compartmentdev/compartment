import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  ResolvedCompartmentServiceRunConfig,
  WorkerBuildArtifactSummary,
  WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { WorkerConfig } from '../src/config';
import { buildReleaseImageFromSource } from '../src/services/worker-build.service';
import type { RunWorkerBuildJobInput, WorkerSourceBuildJobInput } from '../src/services/worker-build-job.types';
import { encryptTestTenantEnvironment, testTenantSecretsKek } from './tenant-secret-test.fixtures';

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
  it('reuses an existing digest-pinned artifact without starting a build Job', async (): Promise<void> => {
    const request: CompartmentRequester = vi.fn() as CompartmentRequester;
    const deployment: WorkerClaimedDeployment = createClaimedDeployment({
      artifact: {
        id: 'art_123',
        imageRef: `127.0.0.1:5517/projects/prj_123/services/svc_123@sha256:${'a'.repeat(64)}`,
        sourceDigest: 'sha256:source',
      },
    });

    await expect(
      buildReleaseImageFromSource(request, deployment, createWorkerConfig(), {} as KubeRuntime),
    ).resolves.toBe(deployment.artifact.imageRef);
    expect(mocks.runWorkerBuildJob).not.toHaveBeenCalled();
  });

  it('projects one tenant-scoped sandbox build with registry cache and decrypted build variables', async (): Promise<void> => {
    mocks.runWorkerBuildJob.mockResolvedValueOnce({
      imageRef: `127.0.0.1:5517/projects/prj_123/services/svc_123@sha256:${'b'.repeat(64)}`,
      pushed: true,
    });
    const deployment: WorkerClaimedDeployment = createClaimedDeployment({
      buildEnv: encryptTestTenantEnvironment({ VITE_PUBLIC_GREETING: 'hello' }),
    });
    const runtime: KubeRuntime = {} as KubeRuntime;

    await expect(
      buildReleaseImageFromSource(vi.fn() as CompartmentRequester, deployment, createWorkerConfig(), runtime),
    ).resolves.toBe(`127.0.0.1:5517/projects/prj_123/services/svc_123@sha256:${'b'.repeat(64)}`);

    const call: [KubeRuntime, object, RunWorkerBuildJobInput] = mocks.runWorkerBuildJob.mock.calls[0]!;
    const build: WorkerSourceBuildJobInput = requireSourceBuild(call[2]);
    expect(call[0]).toBe(runtime);
    expect(call[1]).toEqual(createWorkerConfig().buildSandbox);
    expect(call[2].id).toBe('art_123');
    expect(call[2].internalToken).toBe('runtime-control-token');
    expect(build.apiUrl).toBe('http://api:39444');
    expect(build.artifactId).toBe('art_123');
    expect(build.docker).toMatchObject({
      buildEnv: { VITE_PUBLIC_GREETING: 'hello' },
      cacheImageRef: 'registry:5000/projects/prj_123/services/svc_123:build-cache',
      imageTag: '127.0.0.1:5517/projects/prj_123/services/svc_123:art_123',
      pushImageTag: 'registry:5000/projects/prj_123/services/svc_123:art_123',
    });
  });

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

function requireSourceBuild(input: RunWorkerBuildJobInput): WorkerSourceBuildJobInput {
  if (input.build.kind !== 'source') {
    throw new Error('Expected a source build Job.');
  }
  return input.build;
}

function createWorkerConfig(): WorkerConfig {
  return {
    apiUrl: 'http://api:39444',
    artifactRegistry: {
      address: '127.0.0.1:5517',
      credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
      internalAddress: 'registry:5000',
      internalUrl: 'http://registry:5000',
    },
    buildSandbox: {
      buildKitImage: 'moby/buildkit@sha256:builder',
      buildKitResources: {},
      gcKeepStorageMb: 2000,
      namespace: 'compartment-build',
      runnerImage: 'compartment-worker@sha256:runner',
      runnerResources: {},
      scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
      timeoutMs: 900000,
    },
    buildQueue: { maximumConcurrentBuilds: 2, maximumConcurrentBuildsPerProject: 1 },
    customDomains: {
      caddyServiceName: 'compartment-caddy',
      ingressClassName: 'traefik',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      namespace: 'compartment',
    },
    logLevel: 'silent',
    leaderElection: {
      identity: 'worker-1',
      leaseDurationMs: 15_000,
      renewDeadlineMs: 10_000,
      retryPeriodMs: 2_000,
    },
    pollIntervalMs: 1000,
    runtimeControlToken: 'runtime-control-token',
    tenantSecretsKek: testTenantSecretsKek,
    usageMeteringIntervalMs: 60000,
  };
}

function createClaimedDeployment(
  input: Partial<WorkerClaimedDeployment> & { artifact?: WorkerBuildArtifactSummary } = {},
): WorkerClaimedDeployment {
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
