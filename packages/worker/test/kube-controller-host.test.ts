import { kubeResourceName } from '@compartment/kube-runtime';
import pino, { type Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createKubeControllerHosts, type KubeControllerHost } from '../src/kube-controller-host';
import type { WorkerConfig } from '../src/config';

const unreadyDeadline: string = new Date(Date.now() + 300_000).toISOString();

const claimDeployment: Mock = vi.hoisted((): Mock => vi.fn());
const claimCustomDomain: Mock = vi.hoisted((): Mock => vi.fn());
const claimProductJob: Mock = vi.hoisted((): Mock => vi.fn());
const claimResource: Mock = vi.hoisted((): Mock => vi.fn());
const executeResource: Mock = vi.hoisted((): Mock => vi.fn());
const executeProductJob: Mock = vi.hoisted((): Mock => vi.fn());
const persistProductJobResult: Mock = vi.hoisted((): Mock => vi.fn());
const readKubeObject: Mock = vi.hoisted((): Mock => vi.fn());
const reconcileDeployment: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('@compartment/kube-runtime', async (importActual: () => Promise<object>): Promise<object> => {
  const actual: object = await importActual();
  return { ...actual, createKubeRuntimeFromEnvironment: vi.fn((): object => ({ read: readKubeObject })) };
});
vi.mock('@compartment/sdk', (): object => ({
  claimCustomDomainReconcile: claimCustomDomain,
  claimDeploymentReconcile: claimDeployment,
  claimProductJob,
  claimResourceReconcile: claimResource,
  createCompartmentRequester: vi.fn((): object => ({})),
  persistProductJobResult,
}));
vi.mock('../src/services/worker-artifact-cleanup.service', (): object => ({ cleanupWorkerArtifacts: vi.fn() }));
vi.mock('../src/services/worker-deployment-reconcile.service', (): object => ({
  reconcileDeploymentTarget: reconcileDeployment,
}));
vi.mock('../src/services/worker-product-job.service', (): object => ({
  executeProductJob,
  finalizeRecoveredProductJob: vi.fn(),
}));
vi.mock('../src/services/worker-resource-reconcile.service', (): object => ({
  executeResourceReconcile: executeResource,
}));
vi.mock('../src/services/worker-pod-metrics.service', (): object => ({ collectAndPublishPodMetrics: vi.fn() }));
vi.mock('../src/services/worker-custom-domain-reconcile.service', (): object => ({
  executeCustomDomainReconcile: vi.fn(),
}));

const originalKubeServiceHost: string | undefined = process.env.KUBERNETES_SERVICE_HOST;
const originalKubeconfig: string | undefined = process.env.KUBECONFIG;
const logger: Logger = pino({ level: 'silent' });

describe('createKubeControllerHosts', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    claimDeployment.mockResolvedValue({ target: null });
    claimCustomDomain.mockResolvedValue({ leaseId: null, target: null });
    claimProductJob.mockResolvedValue({ job: null, resourceReadiness: [], result: null });
    claimResource.mockResolvedValue({ intent: null });
    reconcileDeployment.mockResolvedValue([]);
  });

  afterEach((): void => {
    restoreEnvironmentValue('KUBERNETES_SERVICE_HOST', originalKubeServiceHost);
    restoreEnvironmentValue('KUBECONFIG', originalKubeconfig);
  });

  it('fails before the build worker can claim work without Kubernetes access', (): void => {
    delete process.env.KUBERNETES_SERVICE_HOST;
    delete process.env.KUBECONFIG;

    expect((): void => {
      createKubeControllerHosts({} as WorkerConfig, logger);
    }).toThrow('Kubernetes worker requires KUBERNETES_SERVICE_HOST or KUBECONFIG.');
  });

  it('runs resource work independently from deployment work', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';
    claimDeployment.mockResolvedValue({ target: { state: 'desired' } });
    claimResource.mockResolvedValue({ intent: { operation: 'reconcile' } });

    const hosts: KubeControllerHost[] = createKubeControllerHosts(
      {
        artifactRegistry: {},
      } as WorkerConfig,
      logger,
    );

    const results: boolean[] = await Promise.all(
      hosts.map(async (host: KubeControllerHost): Promise<boolean> => await host.reconcile()),
    );

    expect(results).toEqual([true, true, true, false]);
    expect(claimResource).toHaveBeenCalledOnce();
    expect(executeResource).toHaveBeenCalledOnce();
    expect(claimProductJob).toHaveBeenCalledWith(expect.anything(), { jobClass: 'release' });
    expect(claimProductJob).toHaveBeenCalledWith(expect.anything(), { jobClass: 'resource-operation' });
  });

  it('starts every controller when the custom-domain reconcile queue is empty', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';

    const hosts: KubeControllerHost[] = createKubeControllerHosts(
      {
        artifactRegistry: {},
        customDomains: {
          caddyServiceName: 'compartment-caddy',
          ingressClassName: 'traefik',
          issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
          namespace: 'compartment',
        },
      } as WorkerConfig,
      logger,
    );

    expect(hosts).toHaveLength(4);
    await expect(hosts[3]!.reconcile()).resolves.toBe(false);
    expect(claimCustomDomain).toHaveBeenCalledOnce();
  });

  it('keeps release recovery reachable after a deployment reconcile failure', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';
    claimDeployment.mockResolvedValue({ target: { state: 'desired' } });
    reconcileDeployment.mockRejectedValue(new Error('deployment failed'));
    const hosts: KubeControllerHost[] = createKubeControllerHosts({ artifactRegistry: {} } as WorkerConfig, logger);

    await expect(hosts[1]!.reconcile()).rejects.toThrow('deployment failed');

    expect(claimProductJob).toHaveBeenCalledWith(expect.anything(), { jobClass: 'release' });
  });

  it('leaves a claimed Job unstarted while a connected resource is not accepting connections', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';
    claimProductJob.mockResolvedValue(claimedRelease(unreadyDeadline));
    readKubeObject.mockResolvedValue(resourceDeployment(0));
    const hosts: KubeControllerHost[] = createKubeControllerHosts({ artifactRegistry: {} } as WorkerConfig, logger);

    await expect(hosts[1]!.reconcile()).resolves.toBe(false);

    expect(readKubeObject).toHaveBeenCalledWith({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: kubeResourceName('res-db'), namespace: 'cpt-prj-01jz' },
    });
    expect(executeProductJob).not.toHaveBeenCalled();
    expect(persistProductJobResult).not.toHaveBeenCalled();
  });

  it('starts a claimed Job once every connected resource accepts connections', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';
    claimProductJob.mockResolvedValue(claimedRelease(unreadyDeadline));
    readKubeObject.mockResolvedValue(resourceDeployment(1));
    const hosts: KubeControllerHost[] = createKubeControllerHosts({ artifactRegistry: {} } as WorkerConfig, logger);

    await expect(hosts[1]!.reconcile()).resolves.toBe(true);

    expect(executeProductJob).toHaveBeenCalledOnce();
  });

  it('durably fails a claimed Job once a connected resource misses its readiness deadline', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';
    claimProductJob.mockResolvedValue(claimedRelease('2020-01-01T00:00:00.000Z'));
    readKubeObject.mockResolvedValue(resourceDeployment(0));
    const hosts: KubeControllerHost[] = createKubeControllerHosts({ artifactRegistry: {} } as WorkerConfig, logger);

    await expect(hosts[1]!.reconcile()).resolves.toBe(false);

    expect(executeProductJob).not.toHaveBeenCalled();
    expect(persistProductJobResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ identityId: 'dep-01jz', jobName: 'resource-not-ready/dep-01jz', status: 'timed-out' }),
    );
  });

  it('serializes resource operations behind an in-flight resource reconcile', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';
    claimResource.mockResolvedValue({ intent: { operation: 'reconcile' } });
    let finishReconcile: (() => void) | undefined;
    executeResource.mockReturnValue(
      new Promise<void>((resolve: () => void): void => {
        finishReconcile = resolve;
      }),
    );
    const hosts: KubeControllerHost[] = createKubeControllerHosts({ artifactRegistry: {} } as WorkerConfig, logger);

    const iteration: Promise<boolean> = hosts[2]!.reconcile();
    await Promise.resolve();
    expect(claimProductJob).not.toHaveBeenCalledWith(expect.anything(), { jobClass: 'resource-operation' });
    finishReconcile?.();
    await iteration;

    expect(claimProductJob).toHaveBeenCalledWith(expect.anything(), { jobClass: 'resource-operation' });
  });
});

function claimedRelease(deadlineAt: string): object {
  return {
    job: { deploymentId: 'dep-01jz', jobClass: 'release', namespace: 'cpt-prj-01jz', projectId: 'prj-01jz' },
    resourceReadiness: [{ deadlineAt, resourceId: 'res-db' }],
    result: null,
  };
}

function resourceDeployment(availableReplicas: number): object {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { generation: 7, name: kubeResourceName('res-db'), namespace: 'cpt-prj-01jz' },
    spec: { replicas: 1 },
    status: { availableReplicas, observedGeneration: 7, replicas: 1, updatedReplicas: 1 },
  };
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
