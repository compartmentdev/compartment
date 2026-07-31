import { describe, expect, it, vi, type Mock } from 'vitest';
import type { KubeJobResult, KubeJobSpec } from '@compartment/kube-runtime';
import type { WorkerBuildSandboxConfig } from '../src/config';
import { runWorkerBuildJob } from '../src/services/worker-build-job.service';

describe('runWorkerBuildJob', (): void => {
  it('runs a deterministic gVisor Job with an ephemeral rootless BuildKit sidecar and deletes it after capture', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<(spec: KubeJobSpec) => Promise<KubeJobResult>> = vi.fn(
      async (): Promise<KubeJobResult> =>
        await Promise.resolve({
          completedAt: new Date(),
          exitCode: 0,
          finalize,
          jobName: 'job-art-123',
          logs: `${JSON.stringify({
            result: { imageRef: `registry.example/web@sha256:${'a'.repeat(64)}`, pushed: true },
            type: 'result',
          })}\n`,
          podName: 'job-art-123-pod',
          status: 'succeeded',
        }),
    );

    await expect(
      runWorkerBuildJob({ runJob }, buildConfig(), {
        build: {
          docker: {
            imageTag: 'registry.example/web:art_123',
            labels: {},
            pushImageInsecureRegistry: false,
            pushImageTag: 'registry.internal/web:art_123',
            pushRegistryCredentials: { password: 'secret', serverAddress: 'registry.internal', username: 'build' },
          },
          dockerfile: 'FROM scratch\n',
          kind: 'registry-verification',
        },
        id: 'art_123',
        internalToken: 'runtime-control-token',
      }),
    ).resolves.toEqual({
      imageRef: `registry.example/web@sha256:${'a'.repeat(64)}`,
      pushed: true,
    });

    const spec: KubeJobSpec = runJob.mock.calls[0]![0];
    expect(spec).toMatchObject({
      cleanupPolicy: 'delete',
      id: 'art_123',
      jobClass: 'build',
      labels: { 'compartment.dev/job-class': 'build' },
      namespace: 'compartment-build',
      priorityClassName: 'compartment-platform',
      scheduling: { runtimeClassName: 'gvisor' },
      sidecars: [
        {
          image: 'moby/buildkit@sha256:builder',
          name: 'buildkit',
          securityProfile: 'rootless-buildkit',
        },
      ],
    });
    expect(spec.sidecars?.[0]?.args).toContain('--oci-worker-snapshotter=native');
    expect(spec.volumeMounts).toBeUndefined();
    expect(spec.emptyDirVolumes).toEqual(
      expect.arrayContaining([{ name: 'buildkit-data' }, { containerMountPath: '/tmp', name: 'tmp' }]),
    );
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('reports a structured runner failure and still deletes the Job', async (): Promise<void> => {
    const finalize: Mock<() => Promise<void>> = vi.fn(async (): Promise<void> => await Promise.resolve());
    const runJob: Mock<(spec: KubeJobSpec) => Promise<KubeJobResult>> = vi.fn(
      async (): Promise<KubeJobResult> =>
        await Promise.resolve({
          completedAt: new Date(),
          exitCode: 1,
          finalize,
          jobName: 'job-art-123',
          logs: `${JSON.stringify({ message: 'source archive request failed', type: 'failure' })}\n`,
          podName: 'job-art-123-pod',
          status: 'failed',
        }),
    );

    await expect(
      runWorkerBuildJob({ runJob }, buildConfig(), {
        build: {
          docker: {
            imageTag: 'registry.example/web:art_123',
            labels: {},
            pushImageInsecureRegistry: false,
            pushImageTag: 'registry.internal/web:art_123',
            pushRegistryCredentials: { password: 'secret', serverAddress: 'registry.internal', username: 'build' },
          },
          dockerfile: 'FROM scratch\n',
          kind: 'registry-verification',
        },
        id: 'art_123',
        internalToken: 'runtime-control-token',
      }),
    ).rejects.toThrow('Sandboxed build Job job-art-123 failed: source archive request failed');
    expect(finalize).toHaveBeenCalledOnce();
  });
});

function buildConfig(): WorkerBuildSandboxConfig {
  return {
    buildKitImage: 'moby/buildkit@sha256:builder',
    buildKitResources: {},
    gcKeepStorageMb: 2000,
    namespace: 'compartment-build',
    runnerImage: 'compartment-worker@sha256:runner',
    runnerResources: {},
    scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
    timeoutMs: 900000,
  };
}
