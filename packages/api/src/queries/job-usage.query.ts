import { sql } from 'drizzle-orm';
import { jobUsageCheckpoints, jobUsageHourly } from '../db/schema';
import { readDeploymentUsageOwner } from './deployment-usage-owner.query';
import { splitJobIntoHours } from './usage-aggregation.support';
import type { JobUsageSlice } from './usage-aggregation.support.types';
import type { JobUsageExecutor, JobUsageOwner, RecordJobUsageInput } from './job-usage.query.types';

export async function recordJobUsage(tx: JobUsageExecutor, input: RecordJobUsageInput): Promise<void> {
  if (input.completedAt <= input.startedAt) {
    return;
  }
  const owner: JobUsageOwner | undefined = await readDeploymentUsageOwner(tx, input.deploymentId);
  if (owner === undefined) {
    return;
  }
  if (!(await claimJobUsageSource(tx, input.sourceKey))) {
    return;
  }
  for (const slice of splitJobIntoHours(input.startedAt, input.completedAt)) {
    await incrementJobUsageHour(tx, owner, input.jobClass, slice);
  }
}

async function claimJobUsageSource(tx: JobUsageExecutor, sourceKey: string): Promise<boolean> {
  const inserted: { sourceKey: string }[] = await tx
    .insert(jobUsageCheckpoints)
    .values({ sourceKey })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

async function incrementJobUsageHour(
  tx: JobUsageExecutor,
  owner: JobUsageOwner,
  jobClass: 'build' | 'release',
  slice: JobUsageSlice,
): Promise<void> {
  await tx
    .insert(jobUsageHourly)
    .values({ ...owner, ...slice, jobClass })
    .onConflictDoUpdate({
      set: {
        durationSeconds: sql`${jobUsageHourly.durationSeconds} + ${slice.durationSeconds}`,
        jobCount: sql`${jobUsageHourly.jobCount} + ${slice.jobCount}`,
        updatedAt: new Date(),
      },
      target: [
        jobUsageHourly.organizationId,
        jobUsageHourly.projectId,
        jobUsageHourly.environmentId,
        jobUsageHourly.serviceId,
        jobUsageHourly.hourBucket,
        jobUsageHourly.jobClass,
      ],
    });
}
