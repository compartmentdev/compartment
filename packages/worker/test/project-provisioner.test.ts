import type { ProjectProvisioningTargetV2, WorkerCompleteProjectProvisioningV2Request } from '@compartment/contracts';
import {
  kubeNamespaceName,
  KubeRuntime,
  type ApplyBundle,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import pino, { type Logger } from 'pino';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectProvisionerConfig } from '../src/project-provisioner.types';
import { executeProjectProvisioning } from '../src/services/project-provisioning-execution.service';
import { waitForProjectNamespaceDeletion } from '../src/services/project-teardown-wait.service';
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
    let finalized: boolean = false;
    const finalize: Mock = vi.fn(async (): Promise<void> => {
      finalized = true;
      await Promise.resolve();
    });
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      if (bundle.deleteAfterApply !== undefined) {
        expect(finalized).toBe(true);
      }
      return await Promise.resolve([]);
    });
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
      isolationVersion: 1,
      leaseId: 'lease_1',
      projectId: 'prj_1',
      status: 'succeeded',
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalledOnce();
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

  it('adds configured tenant scheduling to project provisioning Jobs', async (): Promise<void> => {
    const apply: Mock = vi.fn<() => Promise<KubeManifest[]>>().mockResolvedValue([]);
    const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(succeededJob(vi.fn())));

    await executeProjectProvisioning(
      requester(true, true),
      runtimeStub(apply, runJob),
      config({
        nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
        tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Exists' }],
      }),
      target,
      loggerStub(),
    );

    expect(runJob.mock.calls[0]?.[0]).toMatchObject({
      scheduling: {
        nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
        tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Exists' }],
      },
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

  it('still cleans authority and retries when terminal Job finalization fails', async (): Promise<void> => {
    const apply: Mock = vi.fn<() => Promise<KubeManifest[]>>().mockResolvedValue([]);
    const finalizeError: Error = new Error('Job finalization failed');
    const finalize: Mock = vi.fn<() => Promise<void>>().mockRejectedValue(finalizeError);
    const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(succeededJob(finalize)));

    await expect(
      executeProjectProvisioning(requester(true, true), runtimeStub(apply, runJob), config(), target, loggerStub()),
    ).rejects.toBe(finalizeError);

    expect(finalize).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('finalizes a failed terminal Job before cleanup and preserves its failure', async (): Promise<void> => {
    let finalized: boolean = false;
    const finalize: Mock = vi.fn(async (): Promise<void> => {
      finalized = true;
      await Promise.resolve();
    });
    const apply: Mock = vi.fn(async (bundle: ApplyBundle): Promise<KubeManifest[]> => {
      if (bundle.deleteAfterApply !== undefined) {
        expect(finalized).toBe(true);
      }
      return await Promise.resolve([]);
    });
    const failedJob: KubeJobResult = {
      ...succeededJob(finalize),
      exitCode: 1,
      logs: 'namespace projection rejected',
      status: 'failed',
    };
    const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(failedJob));

    await expect(
      executeProjectProvisioning(requester(true, true), runtimeStub(apply, runJob), config(), target, loggerStub()),
    ).resolves.toMatchObject({ message: 'namespace projection rejected', status: 'failed' });

    expect(finalize).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('preserves finalization and authority cleanup errors together', async (): Promise<void> => {
    const finalizationError: Error = new Error('Job finalization failed');
    const cleanupError: Error = new Error('authority cleanup failed');
    const apply: Mock = vi
      .fn<() => Promise<KubeManifest[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(cleanupError);
    const runJob: Mock = vi.fn(
      async (): Promise<KubeJobResult> =>
        await Promise.resolve(succeededJob(vi.fn<() => Promise<void>>().mockRejectedValue(finalizationError))),
    );

    let failure: Error | null = null;
    try {
      await executeProjectProvisioning(
        requester(true, true),
        runtimeStub(apply, runJob),
        config(),
        target,
        loggerStub(),
      );
    } catch (error) {
      failure = error instanceof Error ? error : null;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError | null)?.errors).toEqual([finalizationError, cleanupError]);
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
      isolationVersion: 1,
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
    expect(job.env).toMatchObject({
      COMPARTMENT_INSTALLATION_ID: 'inst_1',
      COMPARTMENT_PROJECT_NAME: 'payments',
    });
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
        isolationVersion: 1,
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

  it('keeps a slowly terminating namespace running beyond the old retry window', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const startedAt: number = Date.now();
      const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
      const deleteObjects: Mock = vi.fn(async (): Promise<void> => await Promise.resolve());
      let leaseReports: number = 0;
      const request: CompartmentRequester = async function respond<TResult>(): Promise<TResult> {
        leaseReports += 1;
        return await Promise.resolve({ applied: true } as TResult);
      };
      vi.spyOn(runtime, 'apply').mockResolvedValue([]);
      vi.spyOn(runtime, 'delete').mockImplementation(deleteObjects);
      vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest | null> => {
        if (object.kind !== 'Namespace' || Date.now() - startedAt > 91_000) {
          return await Promise.resolve(null);
        }
        return await Promise.resolve({
          ...object,
          metadata: {
            ...object.metadata,
            deletionTimestamp: new Date('2026-07-21T00:00:00.000Z'),
            finalizers: ['kubernetes'],
            resourceVersion: `${Math.floor((Date.now() - startedAt) / 20_000)}`,
            uid: 'namespace-uid',
          },
        });
      });
      const completion: Promise<WorkerCompleteProjectProvisioningV2Request> = executeProjectProvisioning(
        request,
        runtime,
        config(),
        { ...target, action: 'teardown' },
        loggerStub(),
      );

      await vi.advanceTimersByTimeAsync(92_000);

      await expect(completion).resolves.toMatchObject({ action: 'teardown', status: 'succeeded' });
      expect(leaseReports).toBeGreaterThan(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a terminating namespace only after its progress signature stays unchanged', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
      vi.spyOn(runtime, 'apply').mockResolvedValue([]);
      vi.spyOn(runtime, 'delete').mockResolvedValue();
      vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest | null> => {
        if (object.kind !== 'Namespace') {
          return await Promise.resolve(null);
        }
        return await Promise.resolve({
          ...object,
          metadata: {
            ...object.metadata,
            deletionTimestamp: new Date('2026-07-21T00:00:00.000Z'),
            finalizers: ['kubernetes'],
            resourceVersion: 'unchanged',
            uid: 'namespace-uid',
          },
        });
      });
      const completion: Promise<WorkerCompleteProjectProvisioningV2Request> = executeProjectProvisioning(
        requester(...Array.from({ length: 100 }, (): boolean => true)),
        runtime,
        config(),
        { ...target, action: 'teardown' },
        loggerStub(),
      );

      await vi.advanceTimersByTimeAsync(15 * 60_000 + 1_000);

      await expect(completion).resolves.toMatchObject({
        action: 'teardown',
        message: 'Project Kubernetes namespace teardown stopped making progress.',
        status: 'failed',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails at the absolute teardown deadline while the namespace progress signature keeps changing', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
      let resourceVersion: number = 0;
      const namespace: KubeManifest = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: kubeNamespaceName('prj_1'), uid: 'namespace-uid' },
      };
      vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest> => {
        resourceVersion += 1;
        return await Promise.resolve({
          ...object,
          metadata: {
            ...object.metadata,
            deletionTimestamp: new Date('2026-07-21T00:00:00.000Z'),
            finalizers: ['kubernetes'],
            resourceVersion: `${resourceVersion}`,
          },
        });
      });
      const completion: Promise<void> = waitForProjectNamespaceDeletion(runtime, namespace, vi.fn(), 500);
      const deadlineFailure: Promise<void> = expect(completion).rejects.toThrow(
        'Project Kubernetes namespace teardown did not finish within the absolute teardown deadline.',
      );

      await vi.advanceTimersByTimeAsync(600);

      await deadlineFailure;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the lease alive through transient namespace read failures', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const startedAt: number = Date.now();
      const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
      let leaseReports: number = 0;
      const request: CompartmentRequester = async function respond<TResult>(): Promise<TResult> {
        leaseReports += 1;
        return await Promise.resolve({ applied: true } as TResult);
      };
      vi.spyOn(runtime, 'apply').mockResolvedValue([]);
      vi.spyOn(runtime, 'delete').mockResolvedValue();
      vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest | null> => {
        if (object.kind !== 'Namespace') {
          return await Promise.resolve(null);
        }
        if (Date.now() - startedAt <= 50_000) {
          throw new Error('Kubernetes API temporarily unavailable');
        }
        return await Promise.resolve(null);
      });
      const completion: Promise<WorkerCompleteProjectProvisioningV2Request> = executeProjectProvisioning(
        request,
        runtime,
        config(),
        { ...target, action: 'teardown' },
        loggerStub(),
      );

      await vi.advanceTimersByTimeAsync(51_000);

      await expect(completion).resolves.toMatchObject({ action: 'teardown', status: 'succeeded' });
      expect(leaseReports).toBeGreaterThan(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report a failed attempt after losing the teardown lease heartbeat', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
      vi.spyOn(runtime, 'apply').mockResolvedValue([]);
      vi.spyOn(runtime, 'delete').mockResolvedValue();
      vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest | null> => {
        if (object.kind !== 'Namespace') {
          return await Promise.resolve(null);
        }
        return await Promise.resolve({
          ...object,
          metadata: {
            ...object.metadata,
            deletionTimestamp: new Date('2026-07-21T00:00:00.000Z'),
            resourceVersion: `${Date.now()}`,
            uid: 'namespace-uid',
          },
        });
      });
      const completion: Promise<WorkerCompleteProjectProvisioningV2Request> = executeProjectProvisioning(
        requester(true, true, true, false),
        runtime,
        config(),
        { ...target, action: 'teardown' },
        loggerStub(),
      );
      const leaseLoss: Promise<void> = expect(completion).rejects.toThrow('lease');

      await vi.advanceTimersByTimeAsync(11_000);

      await leaseLoss;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails when namespace deletion never enters the Terminating state', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
      vi.spyOn(runtime, 'apply').mockResolvedValue([]);
      vi.spyOn(runtime, 'delete').mockResolvedValue();
      vi.spyOn(runtime, 'read').mockImplementation(async (object: KubeManifest): Promise<KubeManifest | null> => {
        if (object.kind !== 'Namespace') {
          return await Promise.resolve(null);
        }
        return await Promise.resolve({ ...object, metadata: { ...object.metadata, uid: 'namespace-uid' } });
      });
      const completion: Promise<WorkerCompleteProjectProvisioningV2Request> = executeProjectProvisioning(
        requester(true, true),
        runtime,
        config(),
        { ...target, action: 'teardown' },
        loggerStub(),
      );

      await vi.advanceTimersByTimeAsync(31_000);

      await expect(completion).resolves.toMatchObject({
        message: 'Project Kubernetes namespace did not enter the Terminating state.',
        status: 'failed',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a teardown attempt when the namespace delete call fails', async (): Promise<void> => {
    const runtime: KubeRuntime = Object.create(KubeRuntime.prototype) as KubeRuntime;
    vi.spyOn(runtime, 'apply').mockResolvedValue([]);
    vi.spyOn(runtime, 'delete').mockRejectedValue(new Error('namespace delete rejected'));
    vi.spyOn(runtime, 'read').mockResolvedValue(null);

    await expect(
      executeProjectProvisioning(
        requester(true, true),
        runtime,
        config(),
        { ...target, action: 'teardown' },
        loggerStub(),
      ),
    ).resolves.toMatchObject({ message: 'namespace delete rejected', status: 'failed' });
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
  isolationVersion: 1,
  leaseId: 'lease_1',
  namespaceId: 'prj_1',
  projectId: 'prj_1',
  projectName: 'payments',
};
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');
function config(tenantScheduling?: KubeWorkloadScheduling): ProjectProvisionerConfig {
  return {
    apiUrl: 'http://api.compartment.svc:3000',
    artifactRegistry: {
      address: 'registry.apps.example.com:443',
      credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
      internalAddress: 'registry.apps.example.com:443',
      internalUrl: 'https://registry.apps.example.com',
    },
    edgeNamespace: 'compartment',
    image: 'ghcr.io/compartmentdev/compartment-worker:test',
    installationId: 'inst_1',
    leaderElection: {
      identity: 'project-provisioner-1',
      leaseDurationMs: 15_000,
      leaseName: 'compartment-project-provisioner',
      namespace: 'compartment',
      renewDeadlineMs: 10_000,
      retryPeriodMs: 2_000,
    },
    logLevel: 'info',
    platformNamespace: 'compartment',
    podCidr,
    pollIntervalMs: 1_000,
    provisioningNamespace: 'compartment-project-provisioning',
    runtimeControlToken: 'runtime-token',
    serviceCidr,
    ...(tenantScheduling === undefined ? {} : { tenantScheduling }),
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
