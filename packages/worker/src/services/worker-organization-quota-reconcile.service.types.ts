import type { KubeObservedManifest } from '@compartment/kube-runtime';

type OrganizationQuotaObservedManifestBase = Pick<KubeObservedManifest, keyof KubeObservedManifest>;

export interface OrganizationQuotaStatusCondition {
  status: 'False' | 'True' | 'Unknown';
  type: string;
}

export interface OrganizationQuotaObservedManifest extends OrganizationQuotaObservedManifestBase {
  status?: OrganizationQuotaStatus | undefined;
}

export interface OrganizationQuotaStatus {
  conditions?: OrganizationQuotaStatusCondition[] | undefined;
}
