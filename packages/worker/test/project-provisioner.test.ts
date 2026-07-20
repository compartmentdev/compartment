import type { ProjectProvisioningTargetV2, WorkerCompleteProjectProvisioningV2Request } from '@compartment/contracts';
import {
  kubeNamespaceName,
  KubeRuntime,
  type ApplyBundle,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import pino, { type Logger } from 'pino';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectProvisionerConfig } from '../src/project-provisioner.types';
import { executeProjectProvisioning } from '../src/services/project-provisioning-execution.service';
import { projectProvisionerJobEnvironmentSchema } from '../src/project-provisioning-environment';

describe('project provisioning execution', (): void => {
  it('does not clean bootstrap authority after its provisioning lease is lost', async (): Promise<void> => {
    const apply: Mock = vi.fn();
    const runJob: Mock = vi.fn();

    await expect(
      executeProjectProvisioning(requester(false), runtimeStub(apply, runJob), config(), target, loggerStub()),
    ).rejects.toThrow('lease');

    expect(apply).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it('leaves completed authority for the next claimant when the lease expires during the Job', async (): Promise<void> => {
    const apply: Mock = vi.fn<() => Promise<KubeManifest[]>>().mockResolvedValue([]);
    const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(succeededJob(vi.fn())));

    await expect(
      executeProjectProvisioning(requester(true, false), runtimeStub(apply, runJob), config(), target, loggerStub()),
    ).rejects.toThrow('lease');

    expect(runJob).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });

  it('cleans exact live authority objects under a current lease and preserves Job success', async (): Promise<void> => {
    const finalize: Mock = vi.fn<() => Promise<void>>();
    const apply: Mock = vi.fn<() => Promise<KubeManifest[]>>().mockResolvedValue([]);
    const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(succeededJob(finalize)));
    const logger: Logger = loggerStub();

    const completion: WorkerCompleteProjectProvisioningV2Request = await executeProjectProvisioning(
      requester(true, true),
      runtimeStub(apply, runJob),
      config(),
      target,
      logger,
    );

    expect(completion).toEqual({
      action: 'provision',
      leaseId: 'lease_1',
      projectId: 'prj_1',
      status: 'succeeded',
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(finalize).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    const cleanup: ApplyBundle = apply.mock.calls[1]?.[0] as ApplyBundle;
    expect(cleanup.deleteAfterApply).toHaveLength(4);
    expect(cleanup.deleteAfterApply?.every((object: KubeManifest): boolean => object.metadata?.uid !== undefined)).toBe(
      true,
    );
    const job: KubeJobSpec = runJob.mock.calls[0]?.[0] as KubeJobSpec;
    expect(job).toMatchObject({
      namespace: 'compartment-project-provisioning',
      securityProfile: 'restricted',
      serviceAccountName: kubeNamespaceName('prj_1'),
    });
  });

  it('retries ordinary provisioning after authority cleanup fails without acknowledging success', async (): Promise<void> => {
    const apply: Mock = vi
      .fn<() => Promise<KubeManifest[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('authority cleanup failed'))
      .mockResolvedValue([]);
    const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(succeededJob(vi.fn())));
    const runtime: KubeRuntime = runtimeStub(apply, runJob);

    await expect(
      executeProjectProvisioning(requester(true, true), runtime, config(), target, loggerStub()),
    ).rejects.toThrow('authority cleanup failed');
    await expect(
      executeProjectProvisioning(requester(true, true), runtime, config(), target, loggerStub()),
    ).resolves.toMatchObject({
      status: 'succeeded',
    });

    expect(runJob).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(4);
  });

  it('preserves a live Job after a transient failure until terminal cleanup', async (): Promise<void> => {
    const apply: Mock = vi.fn<() => Promise<KubeManifest[]>>().mockResolvedValue([]);
    const runJob: Mock = vi
      .fn<() => Promise<KubeJobResult>>()
      .mockRejectedValueOnce(new Error('observation startup unavailable'))
      .mockResolvedValueOnce(succeededJob(vi.fn()));
    const runtime: KubeRuntime = runtimeStub(apply, runJob);
    const request: CompartmentRequester = requester(true, true, true);

    await expect(executeProjectProvisioning(request, runtime, config(), target, loggerStub())).rejects.toThrow(
      'observation startup unavailable',
    );
    await expect(executeProjectProvisioning(request, runtime, config(), target, loggerStub())).resolves.toMatchObject({
      status: 'succeeded',
    });

    const firstApply: ApplyBundle = apply.mock.calls[0]?.[0] as ApplyBundle;
    const retryApply: ApplyBundle = apply.mock.calls[1]?.[0] as ApplyBundle;
    const terminalCleanup: ApplyBundle = apply.mock.calls[2]?.[0] as ApplyBundle;
    expect(firstApply.deleteAfterApply).toBeUndefined();
    expect(retryApply.deleteAfterApply).toBeUndefined();
    expect(terminalCleanup.deleteAfterApply).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'Job' })]),
    );
  });

  it('keeps a primary provisioning failure failed while still cleaning authority', async (): Promise<void> => {
    const apply: Mock = vi
      .fn<() => Promise<KubeManifest[]>>()
      .mockRejectedValueOnce(new Error('authority apply failed'))
      .mockResolvedValueOnce([]);
    const runJob: Mock = vi.fn();

    await expect(
      executeProjectProvisioning(requester(true, true), runtimeStub(apply, runJob), config(), target, loggerStub()),
    ).resolves.toEqual({
      action: 'provision',
      leaseId: 'lease_1',
      message: 'authority apply failed',
      projectId: 'prj_1',
      status: 'failed',
    });
    expect(runJob).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('builds a Job environment accepted by the canonical producer-consumer schema', async (): Promise<void> => {
    const apply: Mock = vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([]));
    const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(succeededJob(vi.fn())));

    await executeProjectProvisioning(requester(true, true), runtimeStub(apply, runJob), config(), target, loggerStub());

    const job: KubeJobSpec = runJob.mock.calls[0]?.[0] as KubeJobSpec;
    expect(projectProvisionerJobEnvironmentSchema.parse(job.env)).toEqual(job.env);
  });

  it('acknowledges teardown only after the immutable project namespace is absent', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
      const deleteObjects: Mock = vi.fn(async (): Promise<void> => await Promise.resolve());
      const namespace: KubeManifest = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: kubeNamespaceName('prj_1') },
      };
      const cleanupAuthority: Mock = vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([]));
      let namespaceReads: number = 0;
      vi.spyOn(runtime, 'apply').mockImplementation(cleanupAuthority);
      vi.spyOn(runtime, 'delete').mockImplementation(deleteObjects);
      vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest | null> => {
        if (object.kind === 'Namespace') {
          const observed: KubeManifest | null = namespaceReads === 0 ? namespace : null;
          namespaceReads += 1;
          return await Promise.resolve(observed);
        }
        if (cleanupAuthority.mock.calls.length > 0) {
          return await Promise.resolve(null);
        }
        return await Promise.resolve({
          ...object,
          metadata: { ...object.metadata, resourceVersion: `${object.kind}-rv`, uid: `${object.kind}-uid` },
        });
      });
      const teardownTarget: ProjectProvisioningTargetV2 = { ...target, action: 'teardown' };
      const completion: Promise<WorkerCompleteProjectProvisioningV2Request> = executeProjectProvisioning(
        requester(true, true),
        runtime,
        config(),
        teardownTarget,
        loggerStub(),
      );

      await vi.advanceTimersByTimeAsync(100);
      await expect(completion).resolves.toEqual({
        action: 'teardown',
        leaseId: 'lease_1',
        projectId: 'prj_1',
        status: 'succeeded',
      });
      const cleanup: ApplyBundle = cleanupAuthority.mock.calls[0]?.[0] as ApplyBundle;
      expect(cleanup.deleteAfterApply).toHaveLength(4);
      expect(
        cleanup.deleteAfterApply?.every((object: KubeManifest): boolean => object.metadata?.uid !== undefined),
      ).toBe(true);
      expect(deleteObjects).toHaveBeenCalledWith([namespace]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('acknowledges an idempotent teardown when the project namespace is already absent', async (): Promise<void> => {
    const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
    const cleanupAuthority: Mock = vi.fn(async (): Promise<KubeManifest[]> => await Promise.resolve([]));
    const deleteObjects: Mock = vi.fn(async (): Promise<void> => await Promise.resolve());
    vi.spyOn(runtime, 'apply').mockImplementation(cleanupAuthority);
    vi.spyOn(runtime, 'delete').mockImplementation(deleteObjects);
    vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest | null> => {
      if (object.kind !== 'ClusterRoleBinding') {
        return await Promise.resolve(null);
      }
      return await Promise.resolve({
        ...object,
        metadata: { ...object.metadata, uid: 'foreign-binding' },
        subjects: [{ kind: 'ServiceAccount', name: 'another-project', namespace: 'compartment-project-provisioning' }],
      });
    });
    const teardownTarget: ProjectProvisioningTargetV2 = { ...target, action: 'teardown' };

    await expect(
      executeProjectProvisioning(requester(true), runtime, config(), teardownTarget, loggerStub()),
    ).resolves.toMatchObject({ action: 'teardown', status: 'succeeded' });

    expect(deleteObjects).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'Namespace', metadata: { name: kubeNamespaceName('prj_1') } }),
    ]);
    const cleanup: ApplyBundle = cleanupAuthority.mock.calls[0]?.[0] as ApplyBundle;
    expect(cleanup.deleteAfterApply).toEqual([]);
  });
});

const target: ProjectProvisioningTargetV2 = {
  action: 'provision',
  leaseId: 'lease_1',
  namespaceId: 'prj_1',
  projectId: 'prj_1',
};
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');
function config(): ProjectProvisionerConfig {
  return {
    apiUrl: 'http://api.compartment.svc:3000',
    artifactRegistry: {
      address: 'registry.compartment.svc:5000',
      internalUrl: 'http://registry.compartment.svc:5000',
      mode: 'bundled',
      readCredentials: { password: 'read-password', username: 'read-user' },
      writeCredentials: { password: 'write-password', username: 'write-user' },
    },
    edgeNamespace: 'compartment',
    image: 'ghcr.io/compartmentdev/compartment-worker:test',
    logLevel: 'info',
    platformNamespace: 'compartment',
    podCidr,
    pollIntervalMs: 1_000,
    provisioningNamespace: 'compartment-project-provisioning',
    runtimeControlToken: 'runtime-token',
    serviceCidr,
    workerServiceAccountName: 'compartment-worker',
  };
}

function runtimeStub(apply: Mock, runJob: Mock): KubeRuntime {
  const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
  vi.spyOn(runtime, 'apply').mockImplementation(apply);
  vi.spyOn(runtime, 'read').mockImplementation(
    async (object: KubeManifest): Promise<KubeManifest> =>
      await Promise.resolve({
        ...object,
        metadata: { ...object.metadata, resourceVersion: `${object.kind}-rv`, uid: `${object.kind}-uid` },
      }),
  );
  vi.spyOn(runtime, 'runJob').mockImplementation(runJob);
  return runtime;
}

function requester(...applied: boolean[]): CompartmentRequester {
  let call: number = 0;
  return async function respond<TResult>(): Promise<TResult> {
    const response: boolean = applied[Math.min(call, applied.length - 1)] ?? false;
    call += 1;
    return await Promise.resolve({ applied: response } as TResult);
  };
}

function succeededJob(finalize: Mock): KubeJobResult {
  return {
    completedAt: new Date('2026-07-14T10:00:00.000Z'),
    exitCode: 0,
    finalize,
    jobName: 'job-project-provision-prj-1',
    logs: '',
    podName: 'job-project-provision-prj-1-pod',
    status: 'succeeded',
  };
}

function loggerStub(): Logger {
  const logger: Logger = pino({ level: 'silent' });
  vi.spyOn(logger, 'warn');
  return logger;
}
