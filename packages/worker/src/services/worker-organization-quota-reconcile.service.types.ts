import type { KubeObservedManifest } from '@compartment/kube-runtime';

export interface OrganizationQuotaStatusCondition {
  status: 'False' | 'True' | 'Unknown';
  type: string;
}

export type OrganizationQuotaObservedManifest = KubeObservedManifest & {
  status?: OrganizationQuotaStatus | undefined;
};

export interface OrganizationQuotaStatus {
  conditions?: OrganizationQuotaStatusCondition[] | undefined;
}
