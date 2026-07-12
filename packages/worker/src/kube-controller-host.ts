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
import { executeProductJob, finalizeRecoveredProductJob } from './services/worker-product-job.service';
import { reconcileDeploymentTarget } from './services/worker-deployment-reconcile.service';
import { executeResourceReconcile } from './services/worker-resource-reconcile.service';

export interface KubeControllerHost {
  enabled: boolean;
  reconcile(): Promise<boolean>;
}

interface KubeReconcileArea {
  reconcile(): Promise<boolean>;
}

class RegisteredKubeControllerHost implements KubeControllerHost {
  public readonly enabled: boolean = true;

  public constructor(private readonly areas: KubeReconcileArea[]) {}

  public async reconcile(): Promise<boolean> {
    for (const area of this.areas) {
      if (await area.reconcile()) {
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
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimDeploymentReconcileResponse = await claimDeploymentReconcile(this.request);
    if (claimed.target === null) {
      return false;
    }
    await reconcileDeploymentTarget(this.request, this.runtime, claimed.target);
    return claimed.target.state !== 'active';
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

class DisabledKubeControllerHost implements KubeControllerHost {
  public readonly enabled: boolean = false;

  public async reconcile(): Promise<boolean> {
    return await Promise.resolve(false);
  }
}

export function createKubeControllerHost(config: WorkerConfig): KubeControllerHost {
  if (!isKubeRuntimeConfigured()) {
    return new DisabledKubeControllerHost();
  }
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
  });
  const runtime: KubeRuntime = createKubeRuntimeFromEnvironment();
  return new RegisteredKubeControllerHost([
    new DeploymentReconcileArea(request, runtime),
    new ResourceReconcileArea(request, runtime),
    new ProductJobReconcileArea(request, runtime),
  ]);
}

export function isKubeRuntimeConfigured(): boolean {
  return hasKubeConfiguration(process.env);
}

function hasKubeConfiguration(env: NodeJS.ProcessEnv): boolean {
  return isNonEmptyEnvironmentValue(env.KUBERNETES_SERVICE_HOST) || isNonEmptyEnvironmentValue(env.KUBECONFIG);
}

function isNonEmptyEnvironmentValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}
