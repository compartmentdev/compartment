import type { ProjectNetworkPolicyProjection } from './kube-network-policy-projection.types';

export interface ProjectNamespaceProvisioningRow {
  namespaceId: string;
  networkPolicy: ProjectNetworkPolicyProjection;
  projectId: string;
}
