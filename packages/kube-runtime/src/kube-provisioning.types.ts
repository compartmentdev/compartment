import type { ProjectNetworkPolicyProjection } from './kube-network-policy-projection.types';
import type { ProjectContainerDefaults } from './kube-limit-range-projection.types';
import type { ProjectQuota } from './kube-resource-quota-projection.types';

export interface ProjectNamespaceResourceConfiguration {
  containerDefaults: ProjectContainerDefaults;
  quota: ProjectQuota;
}

export interface ProjectNamespaceProvisioningRow {
  bootstrapServiceAccount: ProjectProvisioningServiceAccount;
  installationId: string;
  namespaceId: string;
  networkPolicy: ProjectNetworkPolicyProjection;
  organizationId: string;
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
