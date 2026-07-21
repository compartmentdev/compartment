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
  ProductJobClass,
} from '@compartment/contracts';
import type { Logger } from 'pino';
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

class DeploymentReconcileArea implements KubeControllerHost {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly artifactRegistry: WorkerArtifactRegistryConfig,
  ) {}

  public async reconcile(): Promise<boolean> {
    let reconciled: boolean = false;
    let deploymentError: Error | null = null;
    try {
      reconciled = await this.reconcileDeployment();
    } catch (error) {
      deploymentError = readControllerError(typeof error === 'object' ? error : null, 'Deployment reconcile failed.');
    }
    let recoveredRelease: boolean;
    try {
      recoveredRelease = await reconcileProductJob(this.request, this.runtime, 'release');
    } catch (releaseError) {
      throwCombinedControllerErrors(
        deploymentError,
        readControllerError(typeof releaseError === 'object' ? releaseError : null, 'Release recovery failed.'),
      );
    }
    if (deploymentError !== null) {
      throw deploymentError;
    }
    return recoveredRelease || reconciled;
  }

  private async reconcileDeployment(): Promise<boolean> {
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

class ResourceReconcileArea implements KubeControllerHost {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimResourceReconcileResponse = await claimResourceReconcile(this.request);
    let reconciled: boolean = false;
    if (claimed.intent !== null) {
      await executeResourceReconcile(this.request, this.runtime, claimed);
      reconciled = true;
    }
    return (await reconcileProductJob(this.request, this.runtime, 'resource-operation')) || reconciled;
  }
}

class PodMetricsReconcileArea implements KubeControllerHost {
  private nextCollectionAt: number = 0;

  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly logger: Logger,
  ) {}

  public async reconcile(): Promise<boolean> {
    if (Date.now() < this.nextCollectionAt) {
      return false;
    }
    this.nextCollectionAt = Date.now() + 10_000;
    await collectAndPublishPodMetrics(this.request, this.runtime, this.logger);
    return true;
  }
}

export function createKubeControllerHosts(config: WorkerConfig, logger: Logger): KubeControllerHost[] {
  if (!isKubeRuntimeConfigured()) {
    throw new Error('Kubernetes worker requires KUBERNETES_SERVICE_HOST or KUBECONFIG.');
  }
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
    requestTimeoutMs: controllerRequestTimeoutMs,
  });
  const runtime: KubeRuntime = createKubeRuntimeFromEnvironment();
  return [
    new PodMetricsReconcileArea(request, runtime, logger),
    new DeploymentReconcileArea(request, runtime, config.artifactRegistry),
    new ResourceReconcileArea(request, runtime),
  ];
}

async function reconcileProductJob(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  jobClass: ProductJobClass,
): Promise<boolean> {
  const claimed: WorkerClaimProductJobResponse = await claimProductJob(request, { jobClass });
  if (claimed.job === null) {
    return false;
  }
  if (claimed.result === null) {
    await executeProductJob(request, runtime, claimed.job);
  } else {
    await finalizeRecoveredProductJob(request, runtime, claimed.job, claimed.result);
  }
  return true;
}

function throwCombinedControllerErrors(deploymentError: Error | null, releaseError: Error): never {
  if (deploymentError === null) {
    throw releaseError;
  }
  throw new AggregateError([deploymentError, releaseError], 'Deployment reconcile and release recovery both failed.');
}

function readControllerError(error: object | null, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
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
