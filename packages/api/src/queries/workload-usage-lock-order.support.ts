import type { WorkloadUsageLockKey } from './workload-usage-lock-order.support.types';

export function compareWorkloadUsageLockKeys(left: WorkloadUsageLockKey, right: WorkloadUsageLockKey): number {
  const textComparisons: number[] = [
    compareCodeUnits(left.organizationId, right.organizationId),
    compareCodeUnits(left.projectId, right.projectId),
    compareCodeUnits(left.environmentId, right.environmentId),
    compareCodeUnits(ownerKind(left), ownerKind(right)),
    compareCodeUnits(ownerId(left), ownerId(right)),
  ];
  const firstDifference: number | undefined = textComparisons.find((comparison: number): boolean => comparison !== 0);
  return firstDifference ?? left.hourBucket.getTime() - right.hourBucket.getTime();
}

function ownerKind(key: WorkloadUsageLockKey): 'resource' | 'service' {
  return key.serviceId === null ? 'resource' : 'service';
}

function ownerId(key: WorkloadUsageLockKey): string {
  return key.serviceId ?? key.resourceId;
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
