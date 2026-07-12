export interface ProjectNetworkPolicyProjection {
  applicationPodLabels: Readonly<Record<string, string>>;
  applicationPort: number;
  edgeNamespaceId: string;
  edgePodLabels: Readonly<Record<string, string>>;
  podCidr: string;
  resourcePodLabels: Readonly<Record<string, string>>;
  resourcePort: number;
  serviceCidr: string;
}
