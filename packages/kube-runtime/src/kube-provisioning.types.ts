import type { ProjectNetworkPolicyProjection } from './kube-network-policy-projection.types';

export interface ProjectNamespaceProvisioningRow {
  namespaceId: string;
  networkPolicy: ProjectNetworkPolicyProjection;
  projectId: string;
  registryPullCredentials: ProjectRegistryPullCredentialProjection;
}

export interface ProjectRegistryPullCredentialProjection {
  dockerConfigJson: string;
  secretId: string;
}
