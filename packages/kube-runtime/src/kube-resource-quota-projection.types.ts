export interface KubeResourceQuotaSpec {
  hard: Record<string, string>;
}

export interface ProjectQuota {
  limitsCpu: string;
  limitsEphemeralStorage: string;
  limitsMemory: string;
  requestsCpu: string;
  requestsEphemeralStorage: string;
  requestsMemory: string;
  requestsStorage: string;
}
