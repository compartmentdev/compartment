export interface KubeResourceQuotaSpec {
  hard: Record<string, string>;
}

export interface ProjectQuota {
  limitsCpu: string;
  limitsMemory: string;
  requestsCpu: string;
  requestsMemory: string;
  requestsStorage: string;
}
