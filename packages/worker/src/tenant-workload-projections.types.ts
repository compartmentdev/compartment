import type { DeploymentReconcileProjection, ResourceReconcileIntent } from '@compartment/contracts';
import type { KubeWorkloadScheduling } from '@compartment/kube-runtime';

interface DecryptedTenantProjectionFields {
  env: Record<string, string>;
  scheduling?: KubeWorkloadScheduling | undefined;
}

export type DecryptedTenantProjection<T extends DeploymentReconcileProjection | ResourceReconcileIntent> = Omit<
  T,
  'env'
> &
  DecryptedTenantProjectionFields;
