import { describe, expect, it } from 'vitest';
import { splitJobIntoHours, splitUsageIntoHours } from '../src/queries/usage-aggregation.support';

describe('usage aggregation', (): void => {
  it('keeps a sample interval in its UTC hour bucket', (): void => {
    expect(
      splitUsageIntoHours({
        cpuMillicores: 250,
        memoryBytes: 1024,
        observedAt: new Date('2026-07-29T12:00:30.000Z'),
        previousObservedAt: new Date('2026-07-29T12:00:00.000Z'),
      }),
    ).toEqual([
      {
        cpuMillicoreSeconds: 7500,
        hourBucket: new Date('2026-07-29T12:00:00.000Z'),
        memoryByteSeconds: 30720,
      },
    ]);
  });

  it('splits elapsed usage at the UTC hour boundary', (): void => {
    expect(
      splitUsageIntoHours({
        cpuMillicores: 100,
        memoryBytes: 200,
        observedAt: new Date('2026-07-29T13:00:30.000Z'),
        previousObservedAt: new Date('2026-07-29T12:59:30.000Z'),
      }),
    ).toEqual([
      {
        cpuMillicoreSeconds: 3000,
        hourBucket: new Date('2026-07-29T12:00:00.000Z'),
        memoryByteSeconds: 6000,
      },
      {
        cpuMillicoreSeconds: 3000,
        hourBucket: new Date('2026-07-29T13:00:00.000Z'),
        memoryByteSeconds: 6000,
      },
    ]);
  });

  it('splits job duration and counts the job only in its completion bucket', (): void => {
    expect(splitJobIntoHours(new Date('2026-07-29T12:59:30.000Z'), new Date('2026-07-29T13:00:30.000Z'))).toEqual([
      { durationSeconds: 30, hourBucket: new Date('2026-07-29T12:00:00.000Z'), jobCount: 0 },
      { durationSeconds: 30, hourBucket: new Date('2026-07-29T13:00:00.000Z'), jobCount: 1 },
    ]);
  });
});
