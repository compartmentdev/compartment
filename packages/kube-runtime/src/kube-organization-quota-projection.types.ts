export interface OrganizationQuotaProjection {
  organizationId: string;
  reconciliationRequestedAt: string;
}

export interface OrganizationQuotaCapacity {
  limitsCpu: string;
  limitsMemory: string;
  requestsCpu: string;
  requestsMemory: string;
  requestsStorage: string;
}

export interface GlobalCustomQuotaSpec {
  limit: string;
  namespaceSelectors: GlobalCustomQuotaLabelSelector[];
  options: GlobalCustomQuotaOptions;
  sources: GlobalCustomQuotaSource[];
}

export interface GlobalCustomQuotaOptions {
  emitMetricPerClaimUsage: false;
}

export interface GlobalCustomQuotaLabelSelector {
  matchLabels: Record<string, string>;
}

export interface GlobalCustomQuotaSource {
  apiVersion: 'v1';
  kind: 'PersistentVolumeClaim' | 'Pod';
  path: string;
  selectors?: GlobalCustomQuotaSourceSelector[] | undefined;
}

export interface GlobalCustomQuotaSourceSelector {
  fieldSelectors: string[];
}
