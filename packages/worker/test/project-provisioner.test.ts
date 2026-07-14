import type { ProjectProvisioningTarget, WorkerCompleteProjectProvisioningRequest } from '@compartment/contracts';
import {
  kubeNamespaceName,
  KubeRuntime,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
} from '@compartment/kube-runtime';
import pino, { type Logger } from 'pino';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectProvisionerConfig } from '../src/project-provisioner.types';
import { executeProjectProvisioning } from '../src/services/project-provisioning-execution.service';

describe('project provisioning execution', (): void => {
  it.each(['finalize', 'authority-cleanup'] as const)(
    'preserves a successful Job result when %s fails',
    async (failure: 'finalize' | 'authority-cleanup'): Promise<void> => {
      const finalize: Mock = vi.fn(async (): Promise<void> => {
        if (failure === 'finalize') {
          throw new Error('finalize failed');
        }
        await Promise.resolve();
      });
      const apply: Mock = vi
        .fn<() => Promise<KubeManifest[]>>()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(async (): Promise<KubeManifest[]> => {
          if (failure === 'authority-cleanup') {
            throw new Error('authority cleanup failed');
          }
          return await Promise.resolve([]);
        });
      const runJob: Mock = vi.fn(async (): Promise<KubeJobResult> => await Promise.resolve(succeededJob(finalize)));
      const logger: Logger = loggerStub();

      const completion: WorkerCompleteProjectProvisioningRequest = await executeProjectProvisioning(
        runtimeStub(apply, runJob),
        config(),
        target,
        logger,
      );

      expect(completion).toEqual({ leaseId: 'lease_1', projectId: 'prj_1', status: 'succeeded' });
      expect(apply).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledOnce();
      const job: KubeJobSpec = runJob.mock.calls[0]?.[0] as KubeJobSpec;
      expect(job).toMatchObject({
        namespace: 'compartment-project-provisioning',
        securityProfile: 'restricted',
        serviceAccountName: kubeNamespaceName('prj_1'),
      });
    },
  );

  it('keeps a primary provisioning failure failed while still cleaning authority', async (): Promise<void> => {
    const apply: Mock = vi
      .fn<() => Promise<KubeManifest[]>>()
      .mockRejectedValueOnce(new Error('authority apply failed'))
      .mockResolvedValueOnce([]);
    const runJob: Mock = vi.fn();

    await expect(
      executeProjectProvisioning(runtimeStub(apply, runJob), config(), target, loggerStub()),
    ).resolves.toEqual({
      leaseId: 'lease_1',
      message: 'authority apply failed',
      projectId: 'prj_1',
      status: 'failed',
    });
    expect(runJob).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

const target: ProjectProvisioningTarget = { leaseId: 'lease_1', namespaceId: 'prj_1', projectId: 'prj_1' };
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
  vi.spyOn(runtime, 'runJob').mockImplementation(runJob);
  return runtime;
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
