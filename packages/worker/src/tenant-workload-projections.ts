import type { KubeJobSpec, KubeResourceReachabilityProbe, KubeWorkloadScheduling } from '@compartment/kube-runtime';
import type { DeploymentReconcileProjection, ResourceReconcileIntent } from '@compartment/contracts';
import { resourceReachabilityProbe } from './resource-reachability-probe';
import { decryptTenantSecretEnvironment } from './tenant-secret-environment';
import type { DecryptedTenantProjection } from './tenant-workload-projections.types';
import type { TenantSecretsKeyring } from './tenant-secret-environment.types';

export function decryptTenantProjection<T extends DeploymentReconcileProjection | ResourceReconcileIntent>(
  row: T,
  scheduling: KubeWorkloadScheduling | undefined,
  tenantSecretsKek: TenantSecretsKeyring,
): DecryptedTenantProjection<T> {
  return {
    ...row,
    env: decryptTenantSecretEnvironment(row.env, tenantSecretsKek),
    ...(scheduling === undefined ? {} : { scheduling }),
  };
}

/**
 * A resource a running application dials has no separate budget to borrow from, so the probe uses each resource's
 * own declared readiness timeout. Exceeding it leaves the Pod pre-Running, which the rollout's infrastructure
 * deadline already governs.
 */
export function tenantApplicationProbe(
  projection: DeploymentReconcileProjection,
  workerImage: string,
): KubeResourceReachabilityProbe | undefined {
  return resourceReachabilityProbe(projection.resourceEndpoints, projection.namespaceId, workerImage);
}

export function tenantJobSpec(spec: KubeJobSpec, scheduling: KubeWorkloadScheduling | undefined): KubeJobSpec {
  return { ...spec, ...(scheduling === undefined ? {} : { scheduling }) };
}
