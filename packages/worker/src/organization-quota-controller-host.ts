import type { WorkerClaimOrganizationQuotaReconcileResponse } from '@compartment/contracts';
import type { KubeRuntime } from '@compartment/kube-runtime';
import { claimOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import { executeOrganizationQuotaReconcile } from './services/worker-organization-quota-reconcile.service';

interface OrganizationQuotaControllerHost {
  reconcile(): Promise<boolean>;
}

export function createOrganizationQuotaControllerHost(
  request: CompartmentRequester,
  runtime: KubeRuntime,
): OrganizationQuotaControllerHost {
  return new OrganizationQuotaReconcileArea(request, runtime);
}

class OrganizationQuotaReconcileArea implements OrganizationQuotaControllerHost {
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
