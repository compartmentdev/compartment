import pino, { type Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createKubeControllerHosts, type KubeControllerHost } from '../src/kube-controller-host';
import type { WorkerConfig } from '../src/config';

const claimDeployment: Mock = vi.hoisted((): Mock => vi.fn());
const claimProductJob: Mock = vi.hoisted((): Mock => vi.fn());
const claimResource: Mock = vi.hoisted((): Mock => vi.fn());
const executeResource: Mock = vi.hoisted((): Mock => vi.fn());
const reconcileDeployment: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('@compartment/kube-runtime', (): object => ({
  createKubeRuntimeFromEnvironment: vi.fn((): object => ({})),
}));
vi.mock('@compartment/sdk', (): object => ({
  claimDeploymentReconcile: claimDeployment,
  claimProductJob,
  claimResourceReconcile: claimResource,
  createCompartmentRequester: vi.fn((): object => ({})),
}));
vi.mock('../src/services/worker-artifact-cleanup.service', (): object => ({ cleanupWorkerArtifacts: vi.fn() }));
vi.mock('../src/services/worker-deployment-reconcile.service', (): object => ({
  reconcileDeploymentTarget: reconcileDeployment,
}));
vi.mock('../src/services/worker-product-job.service', (): object => ({
  executeProductJob: vi.fn(),
  finalizeRecoveredProductJob: vi.fn(),
}));
vi.mock('../src/services/worker-resource-reconcile.service', (): object => ({
  executeResourceReconcile: executeResource,
}));
vi.mock('../src/services/worker-pod-metrics.service', (): object => ({ collectAndPublishPodMetrics: vi.fn() }));

const originalKubeServiceHost: string | undefined = process.env.KUBERNETES_SERVICE_HOST;
const originalKubeconfig: string | undefined = process.env.KUBECONFIG;
const logger: Logger = pino({ level: 'silent' });

describe('createKubeControllerHosts', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    claimDeployment.mockResolvedValue({ target: null });
    claimProductJob.mockResolvedValue({ job: null, result: null });
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

    expect(results).toEqual([true, true, true]);
    expect(claimResource).toHaveBeenCalledOnce();
    expect(executeResource).toHaveBeenCalledOnce();
    expect(claimProductJob).toHaveBeenCalledWith(expect.anything(), { jobClass: 'release' });
    expect(claimProductJob).toHaveBeenCalledWith(expect.anything(), { jobClass: 'resource-operation' });
  });

  it('keeps release recovery reachable after a deployment reconcile failure', async (): Promise<void> => {
    process.env.KUBECONFIG = '/tmp/kubeconfig';
    claimDeployment.mockResolvedValue({ target: { state: 'desired' } });
    reconcileDeployment.mockRejectedValue(new Error('deployment failed'));
    const hosts: KubeControllerHost[] = createKubeControllerHosts({ artifactRegistry: {} } as WorkerConfig, logger);

    await expect(hosts[1]!.reconcile()).rejects.toThrow('deployment failed');

    expect(claimProductJob).toHaveBeenCalledWith(expect.anything(), { jobClass: 'release' });
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

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
