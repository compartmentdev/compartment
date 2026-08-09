import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResolvedCompartmentServiceRunConfig, WorkerClaimedDeployment } from '@compartment/contracts';
import type { KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { verifyBuildSourceArchiveCredential } from '@compartment/utils';
import type { WorkerConfig } from '../src/config';
import { buildReleaseImageFromSource } from '../src/services/worker-build.service';
import type { RunWorkerBuildJobInput } from '../src/services/worker-build-job.types';
import { testTenantSecretsKek } from './tenant-secret-test.fixtures';

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

  it('never hands the installation runtime control token to the build Job', async (): Promise<void> => {
    const jobInput: RunWorkerBuildJobInput = await runSourceBuild();

    expect(JSON.stringify(jobInput)).not.toContain('runtime-control-token');
  });

  it('scopes the build Job credential to the artifact that build is allowed to read', async (): Promise<void> => {
    const jobInput: RunWorkerBuildJobInput = await runSourceBuild();
    const credential: string = requireCredential(jobInput);
    const nowSeconds: number = Math.floor(Date.now() / 1_000);

    expect(verifyBuildSourceArchiveCredential('runtime-control-token', credential, 'art_123', nowSeconds)).toBe(true);
    expect(verifyBuildSourceArchiveCredential('runtime-control-token', credential, 'art_other', nowSeconds)).toBe(
      false,
    );
  });

  it('keeps the build Job credential alive across the configured build timeout and no further', async (): Promise<void> => {
    const nowSeconds: number = Math.floor(Date.now() / 1_000);
    const credential: string = requireCredential(await runSourceBuild());

    expect(verifyBuildSourceArchiveCredential('runtime-control-token', credential, 'art_123', nowSeconds + 900)).toBe(
      true,
    );
    expect(verifyBuildSourceArchiveCredential('runtime-control-token', credential, 'art_123', nowSeconds + 1_205)).toBe(
      false,
    );
  });
});

async function runSourceBuild(): Promise<RunWorkerBuildJobInput> {
  mocks.runWorkerBuildJob.mockResolvedValueOnce({
    imageRef: `registry:5000/web@sha256:${'a'.repeat(64)}`,
    pushed: true,
  });
  await buildReleaseImageFromSource(
    vi.fn() as CompartmentRequester,
    createClaimedDeployment(),
    createWorkerConfig(),
    {} as KubeRuntime,
  );
  const jobInput: RunWorkerBuildJobInput | undefined = mocks.runWorkerBuildJob.mock.calls[0]?.[2];
  if (jobInput === undefined) {
    throw new Error('Expected the source build to submit a build Job.');
  }
  return jobInput;
}

function requireCredential(jobInput: RunWorkerBuildJobInput): string {
  if (!('sourceArchiveCredential' in jobInput)) {
    throw new Error('Expected the source build Job to carry a source archive credential.');
  }
  return jobInput.sourceArchiveCredential;
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
      buildKitResources: { limits: { memory: '3Gi' } },
      gcKeepStorageMb: 1024,
      namespace: 'compartment-build',
      runnerImage: 'compartment-worker@sha256:runner',
      runnerResources: { limits: { memory: '1Gi' } },
      scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
      timeoutMs: 900000,
    },
    buildQueue: { maximumConcurrentBuilds: 2, maximumConcurrentBuildsPerOrganization: 1 },
    customDomains: {
      caddyServiceName: 'compartment-caddy',
      ingressClassName: 'traefik',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      namespace: 'compartment',
    },
    deploymentInfrastructureTimeoutMs: 600_000,
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
