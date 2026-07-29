import type { KubeJobSpec, KubeWorkloadScheduling, ResourceProjectionRow } from '@compartment/kube-runtime';
import type { DeploymentReconcileProjection } from '@compartment/contracts';

interface TenantApplicationProjection extends DeploymentReconcileProjection {
  scheduling?: KubeWorkloadScheduling | undefined;
}

export function tenantApplicationRow(
  row: DeploymentReconcileProjection,
  scheduling: KubeWorkloadScheduling | undefined,
): TenantApplicationProjection {
  return { ...row, ...(scheduling === undefined ? {} : { scheduling }) };
}

export function tenantResourceRow(
  row: ResourceProjectionRow,
  scheduling: KubeWorkloadScheduling | undefined,
): ResourceProjectionRow {
  return { ...row, ...(scheduling === undefined ? {} : { scheduling }) };
}

export function tenantJobSpec(spec: KubeJobSpec, scheduling: KubeWorkloadScheduling | undefined): KubeJobSpec {
  return { ...spec, ...(scheduling === undefined ? {} : { scheduling }) };
}
