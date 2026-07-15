import { createKubeRuntimeFromEnvironment, type KubeRuntime } from '@compartment/kube-runtime';
import {
  claimDeploymentReconcile,
  claimProductJob,
  claimResourceReconcile,
  createCompartmentRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import type {
  WorkerClaimDeploymentReconcileResponse,
  WorkerClaimProductJobResponse,
  WorkerClaimResourceReconcileResponse,
} from '@compartment/contracts';
import type { WorkerConfig } from './config';
import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';
import { cleanupWorkerArtifacts } from './services/worker-artifact-cleanup.service';
import { executeProductJob, finalizeRecoveredProductJob } from './services/worker-product-job.service';
import { reconcileDeploymentTarget } from './services/worker-deployment-reconcile.service';
import { executeResourceReconcile } from './services/worker-resource-reconcile.service';
import { collectAndPublishPodMetrics } from './services/worker-pod-metrics.service';

const controllerRequestTimeoutMs: number = 15_000;

export interface KubeControllerHost {
  reconcile(): Promise<boolean>;
}

interface KubeReconcileArea {
  reconcile(): Promise<boolean | undefined>;
}

class RegisteredKubeControllerHost implements KubeControllerHost {
  public constructor(private readonly areas: KubeReconcileArea[]) {}

  public async reconcile(): Promise<boolean> {
    for (const area of this.areas) {
      if ((await area.reconcile()) === true) {
        return true;
      }
    }
    return false;
  }
}

class ProductJobReconcileArea implements KubeReconcileArea {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimProductJobResponse = await claimProductJob(this.request);
    if (claimed.job === null) {
      return false;
    }
    if (claimed.result === null) {
      await executeProductJob(this.request, this.runtime, claimed.job);
    } else {
      await finalizeRecoveredProductJob(this.request, this.runtime, claimed.job, claimed.result);
    }
    return true;
  }
}

class DeploymentReconcileArea implements KubeReconcileArea {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly artifactRegistry: WorkerArtifactRegistryConfig,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimDeploymentReconcileResponse = await claimDeploymentReconcile(this.request);
    if (claimed.target === null) {
      return false;
    }
    await cleanupWorkerArtifacts(
      await reconcileDeploymentTarget(this.request, this.runtime, claimed.target),
      this.artifactRegistry,
    );
    return claimed.target.state !== 'active' && claimed.target.state !== 'stopped';
  }
}

class ResourceReconcileArea implements KubeReconcileArea {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimResourceReconcileResponse = await claimResourceReconcile(this.request);
    if (claimed.intent === null) {
      return false;
    }
    await executeResourceReconcile(this.request, this.runtime, claimed);
    return true;
  }
}

class PodMetricsReconcileArea implements KubeReconcileArea {
  private nextCollectionAt: number = 0;

  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
  ) {}

  public async reconcile(): Promise<undefined> {
    if (Date.now() < this.nextCollectionAt) {
      return;
    }
    this.nextCollectionAt = Date.now() + 10_000;
    await collectAndPublishPodMetrics(this.request, this.runtime);
  }
}

export function createKubeControllerHost(config: WorkerConfig): KubeControllerHost {
  if (!isKubeRuntimeConfigured()) {
    throw new Error('Kubernetes worker requires KUBERNETES_SERVICE_HOST or KUBECONFIG.');
  }
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
    requestTimeoutMs: controllerRequestTimeoutMs,
  });
  const runtime: KubeRuntime = createKubeRuntimeFromEnvironment();
  return new RegisteredKubeControllerHost([
    new PodMetricsReconcileArea(request, runtime),
    new DeploymentReconcileArea(request, runtime, config.artifactRegistry),
    new ResourceReconcileArea(request, runtime),
    new ProductJobReconcileArea(request, runtime),
  ]);
}

function isKubeRuntimeConfigured(): boolean {
  return hasKubeConfiguration(process.env);
}

function hasKubeConfiguration(env: NodeJS.ProcessEnv): boolean {
  return isNonEmptyEnvironmentValue(env.KUBERNETES_SERVICE_HOST) || isNonEmptyEnvironmentValue(env.KUBECONFIG);
}

function isNonEmptyEnvironmentValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}
