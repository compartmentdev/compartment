type SelfHostedBuildMatrixPartitionName = 'a' | 'b';

export interface SelfHostedBuildMatrixPartitionDefinition {
  readonly multiServiceFixtureNames: readonly string[];
  readonly singleServiceFixtureNames: readonly string[];
}

export const selfHostedBuildMatrixPartitions: Readonly<
  Record<SelfHostedBuildMatrixPartitionName, SelfHostedBuildMatrixPartitionDefinition>
> = Object.freeze({
  a: Object.freeze({
    multiServiceFixtureNames: Object.freeze(['java-api-frontend']),
    singleServiceFixtureNames: Object.freeze([
      'dockerfile',
      'dockerfile-monorepo',
      'railpack',
      'railpack-pnpm-workspace',
      'python',
    ]),
  }),
  b: Object.freeze({
    multiServiceFixtureNames: Object.freeze(['multi-service']),
    singleServiceFixtureNames: Object.freeze([
      'railpack-build-packages',
      'railpack-monorepo',
      'vite-react',
      'static-vite-react',
      'static-poison',
    ]),
  }),
});

export function readSelfHostedBuildMatrixPartition(
  value: string | undefined,
): SelfHostedBuildMatrixPartitionDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'a' && value !== 'b') {
    throw new Error(`Unknown self-hosted build matrix partition: ${value}`);
  }
  return selfHostedBuildMatrixPartitions[value];
}
