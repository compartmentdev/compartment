import type {
  OrganizationQuotaCapacity,
  ProjectContainerDefaults,
  ProjectNamespaceResourceConfiguration,
  ProjectQuota,
} from '../src';

export const projectContainerDefaults: ProjectContainerDefaults = {
  limit: { cpu: '1', 'ephemeral-storage': '1Gi', memory: '512Mi' },
  request: { cpu: '50m', 'ephemeral-storage': '1Gi', memory: '512Mi' },
};

export const projectQuota: ProjectQuota = {
  limitsCpu: '8',
  limitsEphemeralStorage: '8Gi',
  limitsMemory: '8Gi',
  requestsCpu: '2',
  requestsEphemeralStorage: '8Gi',
  requestsMemory: '8Gi',
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
  requestsMemory: '8Gi',
  requestsStorage: '20Gi',
};
