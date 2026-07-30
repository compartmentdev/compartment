import type { KubeJobSpec, KubeWorkloadScheduling } from '@compartment/kube-runtime';
import type { DeploymentReconcileProjection, ResourceReconcileIntent } from '@compartment/contracts';
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

export function tenantJobSpec(spec: KubeJobSpec, scheduling: KubeWorkloadScheduling | undefined): KubeJobSpec {
  return { ...spec, ...(scheduling === undefined ? {} : { scheduling }) };
}
