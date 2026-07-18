import { describe, expect, it } from 'vitest';
import {
  selfHostedMultiServiceBuildFixtures,
  selfHostedSingleServiceBuildFixtures,
  selfHostedStaticPoisonBuildFixtureName,
  type SelfHostedMultiServiceBuildFixture,
  type SelfHostedSingleServiceBuildFixture,
} from './self-hosted-build-matrix-fixtures';
import {
  readSelfHostedBuildMatrixPartition,
  selfHostedBuildMatrixPartitions,
  type SelfHostedBuildMatrixPartitionDefinition,
} from './self-hosted-build-matrix-partitions';

describe('self-hosted build matrix partitions', (): void => {
  it('assigns every fixture exactly once', (): void => {
    const assignedFixtureNames: string[] = Object.values(selfHostedBuildMatrixPartitions).flatMap(
      (partition: SelfHostedBuildMatrixPartitionDefinition): readonly string[] => [
        ...partition.singleServiceFixtureNames,
        ...partition.multiServiceFixtureNames,
      ],
    );
    const expectedFixtureNames: string[] = [
      ...selfHostedSingleServiceBuildFixtures.map(
        (fixture: SelfHostedSingleServiceBuildFixture): string => fixture.name,
      ),
      ...selfHostedMultiServiceBuildFixtures.map((fixture: SelfHostedMultiServiceBuildFixture): string => fixture.name),
      selfHostedStaticPoisonBuildFixtureName,
    ];

    expect(new Set(assignedFixtureNames)).toHaveLength(assignedFixtureNames.length);
    expect(assignedFixtureNames.toSorted(compareFixtureNames)).toEqual(
      expectedFixtureNames.toSorted(compareFixtureNames),
    );
  });

  it('rejects unknown partitions without changing the unpartitioned local default', (): void => {
    expect(readSelfHostedBuildMatrixPartition(undefined)).toBeUndefined();
    expect(readSelfHostedBuildMatrixPartition('a')).toBe(selfHostedBuildMatrixPartitions.a);
    expect((): SelfHostedBuildMatrixPartitionDefinition | undefined =>
      readSelfHostedBuildMatrixPartition('unknown'),
    ).toThrow('Unknown self-hosted build matrix partition: unknown');
  });
});

function compareFixtureNames(left: string, right: string): number {
  return left.localeCompare(right);
}
