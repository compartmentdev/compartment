import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  ResolvedCompartmentServiceRunConfig,
  WorkerBuildArtifactSummary,
  WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { WorkerConfig } from '../src/config';
import type { WorkerDeploymentEventContext } from '../src/services/worker-deployment-event.types';
import { buildReleaseImageFromSource } from '../src/services/worker-build.service';
import type {
  RunWorkerBuildJobInput,
  WorkerBuildJobDockerInput,
  WorkerSourceBuildJobInput,
} from '../src/services/worker-build-job.types';
import { encryptTestTenantEnvironment, testTenantSecretsKek } from './tenant-secret-test.fixtures';

type RunWorkerBuildJob = (
  runtime: KubeRuntime,
  config: object,
  input: RunWorkerBuildJobInput,
) => Promise<{
  imageRef: string;
  pushed: boolean;
}>;

interface WorkerDeploymentEventServiceMock {
  appendDeploymentLogLineSafely: Mock;
  appendDeploymentStepEventSafely: Mock;
  buildDeploymentEventContext: (
    request: CompartmentRequester,
    deployment: WorkerClaimedDeployment,
  ) => WorkerDeploymentEventContext;
}

const mocks: {
  appendDeploymentLogLineSafely: Mock;
  runWorkerBuildJob: Mock<RunWorkerBuildJob>;
} = vi.hoisted(
  (): {
    appendDeploymentLogLineSafely: Mock;
    runWorkerBuildJob: Mock<RunWorkerBuildJob>;
  } => ({
    appendDeploymentLogLineSafely: vi.fn().mockResolvedValue(undefined),
    runWorkerBuildJob: vi.fn<RunWorkerBuildJob>(),
  }),
);

vi.mock('../src/services/worker-build-job.service', (): { runWorkerBuildJob: Mock<RunWorkerBuildJob> } => ({
  runWorkerBuildJob: mocks.runWorkerBuildJob,
}));

vi.mock(
  '../src/services/worker-deployment-event.service',
  (): WorkerDeploymentEventServiceMock => ({
    appendDeploymentLogLineSafely: mocks.appendDeploymentLogLineSafely,
    appendDeploymentStepEventSafely: vi.fn().mockResolvedValue(undefined),
    buildDeploymentEventContext: (
      request: CompartmentRequester,
      deployment: WorkerClaimedDeployment,
    ): WorkerDeploymentEventContext => ({
      deploymentId: deployment.deploymentId,
      deploymentRunId: deployment.deploymentRunId,
      request,
    }),
  }),
);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('buildReleaseImageFromSource', (): void => {
  it('retargets a reusable digest-pinned artifact after the registry Service address changes', async (): Promise<void> => {
    const request: CompartmentRequester = vi.fn() as CompartmentRequester;
    const deployment: WorkerClaimedDeployment = createClaimedDeployment({
      artifact: {
        buildState: 'ready',
        id: 'art_123',
        imageRef: `10.43.250.250:443/projects/prj_123/services/svc_123@sha256:${'a'.repeat(64)}`,
        sourceDigest: `v1:sha256:${'a'.repeat(64)}`,
      },
    });

    await expect(
      buildReleaseImageFromSource(request, deployment, createWorkerConfig(), {} as KubeRuntime),
    ).resolves.toBe(`127.0.0.1:5517/projects/prj_123/services/svc_123@sha256:${'a'.repeat(64)}`);
    expect(mocks.runWorkerBuildJob).not.toHaveBeenCalled();
  });

  it('rebuilds a retained pre-SBOM artifact instead of reusing its legacy image', async (): Promise<void> => {
    mocks.runWorkerBuildJob.mockResolvedValueOnce({
      imageRef: `127.0.0.1:5517/projects/prj_123/services/svc_123@sha256:${'b'.repeat(64)}`,
      pushed: true,
    });
    const deployment: WorkerClaimedDeployment = createClaimedDeployment({
      artifact: {
        buildState: 'building',
        id: 'art_123',
        imageRef: `10.43.250.250:443/projects/prj_123/services/svc_123@sha256:${'a'.repeat(64)}`,
        sourceDigest: `v1:sha256:${'a'.repeat(64)}`,
      },
    });

    await expect(
      buildReleaseImageFromSource(vi.fn() as CompartmentRequester, deployment, createWorkerConfig(), {} as KubeRuntime),
    ).resolves.toContain(`@sha256:${'b'.repeat(64)}`);
    expect(mocks.runWorkerBuildJob).toHaveBeenCalledOnce();
  });

  it('projects one tenant-scoped sandbox build with registry cache and decrypted build variables', async (): Promise<void> => {
    mocks.runWorkerBuildJob.mockImplementationOnce(
      async (
        _runtime: KubeRuntime,
        _config: object,
        input: RunWorkerBuildJobInput,
      ): Promise<{ imageRef: string; pushed: boolean }> => {
        if (input.onProgressLine !== undefined) {
          await input.onProgressLine({ message: 'CACHED build vertex', stream: 'stdout' });
        }
        return {
          imageRef: `127.0.0.1:5517/projects/prj_123/services/svc_123@sha256:${'b'.repeat(64)}`,
          pushed: true,
        };
      },
    );
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
    expect(call[2].jobToken).toBe('build-job-token');
    expect(build.apiUrl).toBe('http://api:39444');
    expect(build.artifactId).toBe('art_123');
    expect(build.docker).toMatchObject({
      buildEnv: { VITE_PUBLIC_GREETING: 'hello' },
      cacheImageRef: 'registry:5000/projects/prj_123/services/svc_123:build-cache',
      imageTag: '127.0.0.1:5517/projects/prj_123/services/svc_123:art_123',
      pushImageTag: 'registry:5000/projects/prj_123/services/svc_123:art_123',
    });
    expect(build.docker.buildSecretFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(build.docker.buildSecretFingerprint).not.toContain('hello');
    expect(build.docker.buildCacheKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(mocks.appendDeploymentLogLineSafely).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'dep_123', deploymentRunId: 'drn_123' }),
      'building_image',
      'stdout',
      'CACHED build vertex',
      'info',
    );
  });

  it('changes the tenant-scoped cache fingerprint when secret plaintext changes but not when key order changes', async (): Promise<void> => {
    mocks.runWorkerBuildJob.mockResolvedValue({
      imageRef: `127.0.0.1:5517/projects/prj_123/services/svc_123@sha256:${'b'.repeat(64)}`,
      pushed: true,
    });
    const fingerprints: string[] = [];
    const cacheKeys: string[] = [];
    for (const buildEnv of [
      { FIRST: 'same', SECOND: 'before' },
      { SECOND: 'before', FIRST: 'same' },
      { FIRST: 'same', SECOND: 'after' },
    ]) {
      await buildReleaseImageFromSource(
        vi.fn() as CompartmentRequester,
        createClaimedDeployment({ buildEnv: encryptTestTenantEnvironment(buildEnv) }),
        createWorkerConfig(),
        {} as KubeRuntime,
      );
      const call: [KubeRuntime, object, RunWorkerBuildJobInput] = mocks.runWorkerBuildJob.mock.calls.at(-1)!;
      const docker: WorkerBuildJobDockerInput = requireSourceBuild(call[2]).docker;
      fingerprints.push(requireFingerprint(docker.buildSecretFingerprint));
      cacheKeys.push(requireFingerprint(docker.buildCacheKey));
    }
    expect(fingerprints[0]).toBe(fingerprints[1]);
    expect(fingerprints[0]).not.toBe(fingerprints[2]);
    expect(fingerprints.join(' ')).not.toContain('before');
    expect(fingerprints.join(' ')).not.toContain('after');
    expect(new Set(cacheKeys).size).toBe(1);
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

function requireFingerprint(fingerprint: string | undefined): string {
  if (fingerprint === undefined) {
    throw new Error('Expected the build secret fingerprint.');
  }
  return fingerprint;
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
    artifact: input.artifact ?? {
      buildState: 'building',
      id: 'art_123',
      imageRef: null,
      sourceDigest: `v1:sha256:${'a'.repeat(64)}`,
    },
    buildJobToken: 'build-job-token',
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
