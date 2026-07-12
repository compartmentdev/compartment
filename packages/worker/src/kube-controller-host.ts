import { createKubeRuntimeFromEnvironment, type KubeRuntime } from '@compartment/kube-runtime';
import { claimProductJob, createCompartmentRequester, type CompartmentRequester } from '@compartment/sdk';
import type { WorkerClaimProductJobResponse } from '@compartment/contracts';
import type { WorkerConfig } from './config';
import { executeProductJob, finalizeRecoveredProductJob } from './services/worker-product-job.service';

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
      if (await area.reconcile()) return true;
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
    if (claimed.job === null) return false;
    if (claimed.result === null) await executeProductJob(this.request, this.runtime, claimed.job);
    else await finalizeRecoveredProductJob(this.request, this.runtime, claimed.job, claimed.result);
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
  if (!hasKubeConfiguration(process.env)) return new DisabledKubeControllerHost();
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
  });
  const runtime: KubeRuntime = createKubeRuntimeFromEnvironment();
  return new RegisteredKubeControllerHost([new ProductJobReconcileArea(request, runtime)]);
}

function hasKubeConfiguration(env: NodeJS.ProcessEnv): boolean {
  return isNonEmptyEnvironmentValue(env.KUBERNETES_SERVICE_HOST) || isNonEmptyEnvironmentValue(env.KUBECONFIG);
}

function isNonEmptyEnvironmentValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}
