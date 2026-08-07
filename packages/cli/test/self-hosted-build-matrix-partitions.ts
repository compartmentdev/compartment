export interface SelfHostedBuildMatrixPartitionDefinition {
  readonly multiServiceFixtureNames: readonly string[];
  readonly singleServiceFixtureNames: readonly string[];
}

export const selfHostedBuildMatrixPartitions: Readonly<Record<string, SelfHostedBuildMatrixPartitionDefinition>> =
  Object.freeze({
    // Pull requests prove the default builder and the multi-service topology; the remaining
    // builders run in the full matrix, which stays self-sufficient rather than assuming a
    // pull-request run covered part of it.
    pr: Object.freeze({
      multiServiceFixtureNames: Object.freeze(['multi-service']),
      singleServiceFixtureNames: Object.freeze(['railpack']),
    }),
    a: Object.freeze({
      multiServiceFixtureNames: Object.freeze(['multi-service']),
      singleServiceFixtureNames: Object.freeze([
        'railpack',
        'railpack-pnpm-workspace',
        'railpack-monorepo',
        'railpack-build-packages',
      ]),
    }),
    b: Object.freeze({
      multiServiceFixtureNames: Object.freeze(['java-api-frontend']),
      singleServiceFixtureNames: Object.freeze([
        'dockerfile',
        'dockerfile-monorepo',
        'python',
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
  if (!Object.hasOwn(selfHostedBuildMatrixPartitions, value)) {
    throw new Error(`Unknown self-hosted build matrix partition: ${value}`);
  }
  return selfHostedBuildMatrixPartitions[value];
}
