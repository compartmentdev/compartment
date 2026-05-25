import {
  isCompartmentResourceOperationCronExpression,
  type CompartmentResourceOperationScheduleConfig,
} from '@compartment/contracts';
import { CronExpressionParser } from 'cron-parser';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';

const minuteMs: number = 60 * 1000;
const hourMs: number = 60 * minuteMs;
const dayMs: number = 24 * hourMs;
const cronInitialRunLookbackMs: number = 5 * minuteMs;

export function isResourceOperationScheduleDue(
  schedule: CompartmentResourceOperationScheduleConfig,
  lastRun: ResourceBackupRow | null,
  now: Date,
): boolean {
  const lastRunAt: Date | null = lastRun?.createdAt ?? null;
  if (schedule.interval !== undefined) {
    return isIntervalScheduleDue(schedule.interval, lastRunAt, now);
  }

  return isCronScheduleDue(schedule.cron ?? '', lastRunAt, now);
}

function isIntervalScheduleDue(interval: 'daily' | 'hourly', lastRunAt: Date | null, now: Date): boolean {
  if (lastRunAt === null) {
    return true;
  }

  const intervalMs: number = interval === 'hourly' ? hourMs : dayMs;

  return now.getTime() - lastRunAt.getTime() >= intervalMs;
}

function isCronScheduleDue(cron: string, lastRunAt: Date | null, now: Date): boolean {
  const occurrence: Date | null = findMostRecentCronOccurrence(cron, now);
  if (occurrence === null) {
    return false;
  }

  if (lastRunAt === null) {
    return now.getTime() - occurrence.getTime() < cronInitialRunLookbackMs;
  }

  return lastRunAt.getTime() < occurrence.getTime();
}

function findMostRecentCronOccurrence(cron: string, now: Date): Date | null {
  if (!isCompartmentResourceOperationCronExpression(cron)) {
    return null;
  }

  try {
    return CronExpressionParser.parse(cron, { currentDate: readNextMinuteBoundary(now), tz: 'UTC' })
      .prev()
      .toDate();
  } catch {
    return null;
  }
}

function readNextMinuteBoundary(date: Date): Date {
  return new Date(truncateToMinute(date).getTime() + minuteMs);
}

function truncateToMinute(date: Date): Date {
  const truncated: Date = new Date(date);
  truncated.setUTCSeconds(0, 0);

  return truncated;
}
