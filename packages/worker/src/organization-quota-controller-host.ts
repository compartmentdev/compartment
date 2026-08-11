import type { WorkerClaimOrganizationQuotaReconcileResponse } from '@compartment/contracts';
import type { KubeRuntime, OrganizationQuotaCapacity } from '@compartment/kube-runtime';
import { claimOrganizationQuotaReconcile, type CompartmentRequester } from '@compartment/sdk';
import { executeOrganizationQuotaReconcile } from './services/worker-organization-quota-reconcile.service';

interface OrganizationQuotaControllerHost {
  reconcile(): Promise<boolean>;
}

export function createOrganizationQuotaControllerHost(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  capacity: OrganizationQuotaCapacity,
): OrganizationQuotaControllerHost {
  return new OrganizationQuotaReconcileArea(request, runtime, capacity);
}

class OrganizationQuotaReconcileArea implements OrganizationQuotaControllerHost {
  public constructor(
    private readonly request: CompartmentRequester,
    private readonly runtime: KubeRuntime,
    private readonly capacity: OrganizationQuotaCapacity,
  ) {}

  public async reconcile(): Promise<boolean> {
    const claimed: WorkerClaimOrganizationQuotaReconcileResponse = await claimOrganizationQuotaReconcile(this.request);
    if (claimed.target === null) {
      return false;
    }
    await executeOrganizationQuotaReconcile(this.request, this.runtime, claimed.target, this.capacity);
    return true;
  }
}
