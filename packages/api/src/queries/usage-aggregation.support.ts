import type { JobUsageSlice, UsageHourSlice, UsageInterval } from './usage-aggregation.support.types';

const hourMs: number = 60 * 60 * 1000;

export function splitUsageIntoHours(input: UsageInterval): UsageHourSlice[] {
  const slices: UsageHourSlice[] = [];
  let cursorMs: number = input.previousObservedAt.getTime();
  const observedAtMs: number = input.observedAt.getTime();
  while (cursorMs < observedAtMs) {
    const bucketMs: number = readUsageHourBucket(new Date(cursorMs)).getTime();
    const sliceEndMs: number = Math.min(observedAtMs, bucketMs + hourMs);
    const seconds: number = (sliceEndMs - cursorMs) / 1000;
    slices.push({
      cpuMillicoreSeconds: Math.round(input.cpuMillicores * seconds),
      hourBucket: new Date(bucketMs),
      memoryByteSeconds: Math.round(input.memoryBytes * seconds),
    });
    cursorMs = sliceEndMs;
  }
  return slices;
}

export function splitJobIntoHours(startedAt: Date, completedAt: Date): JobUsageSlice[] {
  const slices: JobUsageSlice[] = [];
  let cursorMs: number = startedAt.getTime();
  const completedAtMs: number = completedAt.getTime();
  while (cursorMs < completedAtMs) {
    const bucketMs: number = readUsageHourBucket(new Date(cursorMs)).getTime();
    const sliceEndMs: number = Math.min(completedAtMs, bucketMs + hourMs);
    slices.push({
      durationSeconds: Math.round((sliceEndMs - cursorMs) / 1000),
      hourBucket: new Date(bucketMs),
      jobCount: sliceEndMs === completedAtMs ? 1 : 0,
    });
    cursorMs = sliceEndMs;
  }
  return slices;
}

export function readUsageHourBucket(observedAt: Date): Date {
  return new Date(Math.floor(observedAt.getTime() / hourMs) * hourMs);
}
