import type {
  OrganizationQuotaCapacity,
  ProjectContainerDefaults,
  ProjectNamespaceResourceConfiguration,
  ProjectQuota,
} from '../src';

export const projectContainerDefaults: ProjectContainerDefaults = {
  limit: { cpu: '1', memory: '1Gi' },
  request: { cpu: '50m', memory: '256Mi' },
};

export const projectQuota: ProjectQuota = {
  limitsCpu: '8',
  limitsMemory: '8Gi',
  requestsCpu: '2',
  requestsMemory: '2Gi',
  requestsStorage: '20Gi',
};

export const projectResourceConfiguration: ProjectNamespaceResourceConfiguration = {
  containerDefaults: projectContainerDefaults,
  quota: projectQuota,
};

export const organizationQuotaCapacity: OrganizationQuotaCapacity = {
  limitsCpu: '8',
  limitsMemory: '8Gi',
  requestsCpu: '2',
  requestsMemory: '2Gi',
  requestsStorage: '20Gi',
};
