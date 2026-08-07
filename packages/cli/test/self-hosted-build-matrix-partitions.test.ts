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

const fullMatrixPartitionNames: readonly string[] = ['a', 'b'];

describe('self-hosted build matrix partitions', (): void => {
  it('assigns every fixture exactly once across the full matrix', (): void => {
    const assignedFixtureNames: string[] = fullMatrixPartitionNames
      .map(readPartition)
      .flatMap((partition: SelfHostedBuildMatrixPartitionDefinition): readonly string[] => [
        ...partition.singleServiceFixtureNames,
        ...partition.multiServiceFixtureNames,
      ]);
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

  it('keeps the pull-request partition a subset of the full matrix', (): void => {
    const pullRequestPartition: SelfHostedBuildMatrixPartitionDefinition = readPartition('pr');
    const fullMatrixFixtureNames: Set<string> = new Set<string>(
      fullMatrixPartitionNames
        .map(readPartition)
        .flatMap((partition: SelfHostedBuildMatrixPartitionDefinition): readonly string[] => [
          ...partition.singleServiceFixtureNames,
          ...partition.multiServiceFixtureNames,
        ]),
    );

    expect(pullRequestPartition).toEqual({
      multiServiceFixtureNames: ['multi-service'],
      singleServiceFixtureNames: ['railpack'],
    });
    expect(
      [...pullRequestPartition.singleServiceFixtureNames, ...pullRequestPartition.multiServiceFixtureNames].every(
        (fixtureName: string): boolean => fullMatrixFixtureNames.has(fixtureName),
      ),
    ).toBe(true);
  });

  it('rejects unknown partitions without changing the unpartitioned local default', (): void => {
    expect(readSelfHostedBuildMatrixPartition(undefined)).toBeUndefined();
    expect(readSelfHostedBuildMatrixPartition('a')).toBe(selfHostedBuildMatrixPartitions.a);
    expect((): SelfHostedBuildMatrixPartitionDefinition | undefined =>
      readSelfHostedBuildMatrixPartition('unknown'),
    ).toThrow('Unknown self-hosted build matrix partition: unknown');
  });
});

function readPartition(partitionName: string): SelfHostedBuildMatrixPartitionDefinition {
  const partition: SelfHostedBuildMatrixPartitionDefinition | undefined =
    selfHostedBuildMatrixPartitions[partitionName];
  if (partition === undefined) {
    throw new Error(`Expected a self-hosted build matrix partition named ${partitionName}.`);
  }

  return partition;
}

function compareFixtureNames(left: string, right: string): number {
  return left.localeCompare(right);
}
