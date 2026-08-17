interface WorkloadUsageOwnerBase {
  environmentId: string;
  organizationId: string;
  projectId: string;
}

interface ResourceWorkloadUsageOwner extends WorkloadUsageOwnerBase {
  resourceId: string;
  serviceId: null;
}

interface ServiceWorkloadUsageOwner extends WorkloadUsageOwnerBase {
  resourceId: null;
  serviceId: string;
}

interface WorkloadUsageHourKey {
  hourBucket: Date;
}

export type WorkloadUsageOwner = ResourceWorkloadUsageOwner | ServiceWorkloadUsageOwner;
export type WorkloadUsageLockKey = WorkloadUsageOwner & WorkloadUsageHourKey;
