import type { ProjectNetworkPolicyProjection } from './kube-network-policy-projection.types';

export interface ProjectNamespaceProvisioningRow {
  bootstrapServiceAccount: ProjectProvisioningServiceAccount;
  installationId: string;
  namespaceId: string;
  networkPolicy: ProjectNetworkPolicyProjection;
  projectId: string;
  projectName: string;
  registryPullCredentials: ProjectRegistryPullCredentialProjection;
  workerServiceAccount: ProjectProvisioningServiceAccount;
}

export interface ProjectProvisioningServiceAccount {
  name: string;
  namespace: string;
}

export interface ProjectRegistryPullCredentialProjection {
  dockerConfigJson: string;
  secretId: string;
}
