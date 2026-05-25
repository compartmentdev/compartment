import type { ResolvedDescriptorService, ResolvedProjectContext } from './deployments.service.types';

export interface PrepareDescriptorServiceConnectionBindingPlanInput {
  actorPrincipalId: string;
  contexts: readonly ResolvedProjectContext[];
}

export interface ValidateDescriptorServiceConnectionBindingPreflightInput {
  actorPrincipalId: string;
  environmentName: string;
  organizationSlug: string;
  projectName: string;
  services: readonly ResolvedDescriptorService[];
}

export interface ApplyDescriptorServiceConnectionBindingPlanInput {
  plan: DescriptorServiceConnectionBindingPlan;
}

export interface DescriptorServiceConnectionBindingPlan {
  actorPrincipalId: string;
  removals: DescriptorServiceConnectionBindingRemovalInput[];
  upserts: DescriptorServiceConnectionBindingInput[];
}

export interface DescriptorServiceConnectionBindingInput {
  environmentId: string;
  keyName: string;
  organizationId: string;
  outputName: string;
  resourceName: string;
  serviceName: string;
  targetServiceId: string;
}

export interface DescriptorServiceConnectionBindingRemovalInput {
  environmentId: string;
  keyName: string;
  organizationId: string;
  serviceName: string;
  targetServiceId: string;
}
