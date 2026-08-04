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
    const coveragePartitions: readonly SelfHostedBuildMatrixPartitionDefinition[] = [
      'a-1',
      'a-2',
      'b-1',
      'b-2',
      'b-3',
    ].map(
      (partitionName: string): SelfHostedBuildMatrixPartitionDefinition =>
        selfHostedBuildMatrixPartitions[partitionName]!,
    );
    const assignedFixtureNames: string[] = coveragePartitions.flatMap(
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

  it('keeps timing-balanced fixtures in their isolated partitions', (): void => {
    expect(selfHostedBuildMatrixPartitions['a-1']).toEqual({
      multiServiceFixtureNames: [],
      singleServiceFixtureNames: ['railpack', 'railpack-pnpm-workspace'],
    });
    expect(selfHostedBuildMatrixPartitions['a-2']).toEqual({
      multiServiceFixtureNames: ['java-api-frontend'],
      singleServiceFixtureNames: ['dockerfile', 'dockerfile-monorepo', 'python'],
    });
    expect(selfHostedBuildMatrixPartitions['b-1']).toEqual({
      multiServiceFixtureNames: ['multi-service'],
      singleServiceFixtureNames: ['railpack-monorepo'],
    });
    expect(selfHostedBuildMatrixPartitions['b-2']).toEqual({
      multiServiceFixtureNames: [],
      singleServiceFixtureNames: ['railpack-build-packages', 'static-poison'],
    });
    expect(selfHostedBuildMatrixPartitions['b-3']).toEqual({
      multiServiceFixtureNames: [],
      singleServiceFixtureNames: ['vite-react', 'static-vite-react'],
    });
  });

  it('keeps the gVisor smoke partition to one source build', (): void => {
    expect(selfHostedBuildMatrixPartitions.gvisor).toEqual({
      multiServiceFixtureNames: [],
      singleServiceFixtureNames: ['dockerfile'],
    });
  });

  it('rejects unknown partitions without changing the unpartitioned local default', (): void => {
    expect(readSelfHostedBuildMatrixPartition(undefined)).toBeUndefined();
    expect(readSelfHostedBuildMatrixPartition('a-1')).toBe(selfHostedBuildMatrixPartitions['a-1']);
    expect((): SelfHostedBuildMatrixPartitionDefinition | undefined =>
      readSelfHostedBuildMatrixPartition('unknown'),
    ).toThrow('Unknown self-hosted build matrix partition: unknown');
  });
});

function compareFixtureNames(left: string, right: string): number {
  return left.localeCompare(right);
}
