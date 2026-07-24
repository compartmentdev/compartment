export interface ProjectNetworkPolicyProjection {
  applicationPodLabels: Readonly<Record<string, string>>;
  applicationPorts: number[];
  edgeNamespaceName: string;
  edgePodLabels: Readonly<Record<string, string>>;
  podCidr: string;
  resourcePodLabels: Readonly<Record<string, string>>;
  resourcePorts: number[];
  serviceCidr: string;
}
