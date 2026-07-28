export interface KubeResourceQuotaSpec {
  hard: Record<string, string>;
}
