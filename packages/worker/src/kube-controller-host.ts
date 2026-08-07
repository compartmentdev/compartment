import {
  createKubeRuntimeFromEnvironment,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import {
  claimCustomDomainReconcile,
  claimDeploymentReconcile,
  claimOrganizationQuotaReconcile,
  claimProductJob,
  claimResourceReconcile,
  createCompartmentRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import type {
  WorkerClaimCustomDomainReconcileResponse,
  WorkerClaimDeploymentReconcileResponse,
  WorkerClaimOrganizationQuotaReconcileResponse,
  WorkerClaimProductJobResponse,
  WorkerClaimResourceReconcileResponse,
  ProductJobClass,
} from '@compartment/contracts';
import type { Logger } from 'pino';
import type { WorkerConfig, WorkerCustomDomainConfig } from './config';
import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';
import type { TenantSecretsKeyring } from './tenant-secret-environment.types';
import { cleanupWorkerArtifacts } from './services/worker-artifact-cleanup.service';
import { executeProductJob, finalizeRecoveredProductJob } from './services/worker-product-job.service';
import { reconcileDeploymentTarget } from './services/worker-deployment-reconcile.service';
import { DeploymentRolloutStartTracker } from './services/worker-deployment-rollout-start-tracker.service';
import { executeResourceReconcile } from './services/worker-resource-reconcile.service';
import { collectAndPublishPodMetrics } from './services/worker-pod-metrics.service';
import { executeCustomDomainReconcile } from './services/worker-custom-domain-reconcile.service';
import { executeOrganizationQuotaReconcile } from './services/worker-organization-quota-reconcile.service';

const controllerRequestTimeoutMs: number = 15_000;

export interface KubeControllerHost {
  reconcile(): Promise<boolean>;
}

class DeploymentReconcileArea implements KubeControllerHost {
  readonly #rolloutStarts: DeploymentRolloutStartTracker = new DeploymentRolloutStartTracker();

  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly artifactRegistry: WorkerArtifactRegistryConfig,
    private readonly tenantSecretsKek: TenantSecretsKeyring,
    private readonly deploymentInfrastructureTimeoutMs: number,
    private readonly scheduling: KubeWorkloadScheduling | undefined,
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
      recoveredRelease = await this.reconcileRelease();
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

  private async reconcileRelease(): Promise<boolean> {
    return await reconcileProductJob(this.request, this.runtime, 'release', this.tenantSecretsKek, this.scheduling);
  }

  private async reconcileDeployment(): Promise<boolean> {
    const claimed: WorkerClaimDeploymentReconcileResponse = await claimDeploymentReconcile(this.request);
    if (claimed.target === null) {
      return false;
    }
    await cleanupWorkerArtifacts(
      await reconcileDeploymentTarget(
        this.request,
        this.runtime,
        claimed.target,
        this.artifactRegistry,
        this.tenantSecretsKek,
        this.deploymentInfrastructureTimeoutMs,
        this.#rolloutStarts,
        this.scheduling,
      ),
      this.artifactRegistry,
    );
    return claimed.target.state !== 'active' && claimed.target.state !== 'stopped';
  }
}

class ResourceReconcileArea implements KubeControllerHost {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly tenantSecretsKek: TenantSecretsKeyring,
    private readonly scheduling: KubeWorkloadScheduling | undefined,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimResourceReconcileResponse = await claimResourceReconcile(this.request);
    let reconciled: boolean = false;
    if (claimed.intent !== null) {
      await executeResourceReconcile(this.request, this.runtime, claimed, this.tenantSecretsKek, this.scheduling);
      reconciled = true;
    }
    return (
      (await reconcileProductJob(
        this.request,
        this.runtime,
        'resource-operation',
        this.tenantSecretsKek,
        this.scheduling,
      )) || reconciled
    );
  }
}

class PodMetricsReconcileArea implements KubeControllerHost {
  private nextCollectionAt: number = 0;

  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly logger: Logger,
    private readonly intervalMs: number,
  ) {}

  public async reconcile(): Promise<boolean> {
    if (Date.now() < this.nextCollectionAt) {
      return false;
    }
    this.nextCollectionAt = Date.now() + this.intervalMs;
    await collectAndPublishPodMetrics(this.request, this.runtime, this.logger);
    return true;
  }
}

class CustomDomainReconcileArea implements KubeControllerHost {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly config: WorkerCustomDomainConfig,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimCustomDomainReconcileResponse = await claimCustomDomainReconcile(this.request);
    if (claimed.target === null) {
      return false;
    }
    await executeCustomDomainReconcile(this.request, this.runtime, claimed, this.config);
    return true;
  }
}

class OrganizationQuotaReconcileArea implements KubeControllerHost {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimOrganizationQuotaReconcileResponse = await claimOrganizationQuotaReconcile(this.request);
    if (claimed.target === null) {
      return false;
    }
    await executeOrganizationQuotaReconcile(this.request, this.runtime, claimed.target);
    return true;
  }
}

export function createKubeControllerHosts(
  config: WorkerConfig,
  logger: Logger,
  runtime: KubeRuntime = createKubeRuntimeFromEnvironment(),
): KubeControllerHost[] {
  assertKubeRuntimeConfigured();
  const request: CompartmentRequester = createControllerRequester(config);
  return [
    new PodMetricsReconcileArea(request, runtime, logger, config.usageMeteringIntervalMs),
    new DeploymentReconcileArea(
      request,
      runtime,
      config.artifactRegistry,
      config.tenantSecretsKek,
      config.deploymentInfrastructureTimeoutMs,
      config.tenantScheduling,
    ),
    new ResourceReconcileArea(request, runtime, config.tenantSecretsKek, config.tenantScheduling),
    new CustomDomainReconcileArea(request, runtime, config.customDomains),
    new OrganizationQuotaReconcileArea(request, runtime),
  ];
}

function createControllerRequester(config: WorkerConfig): CompartmentRequester {
  return createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
    requestTimeoutMs: controllerRequestTimeoutMs,
  });
}

function assertKubeRuntimeConfigured(): void {
  if (!isKubeRuntimeConfigured()) {
    throw new Error('Kubernetes worker requires KUBERNETES_SERVICE_HOST or KUBECONFIG.');
  }
}

async function reconcileProductJob(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  jobClass: ProductJobClass,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<boolean> {
  const claimed: WorkerClaimProductJobResponse = await claimProductJob(request, { jobClass });
  if (claimed.job === null) {
    return false;
  }
  if (claimed.result === null) {
    await executeProductJob(request, runtime, claimed.job, tenantSecretsKek, scheduling);
  } else {
    await finalizeRecoveredProductJob(request, runtime, claimed.job, claimed.result, tenantSecretsKek, scheduling);
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
