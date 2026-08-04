export interface SelfHostedBuildMatrixPartitionDefinition {
  readonly multiServiceFixtureNames: readonly string[];
  readonly singleServiceFixtureNames: readonly string[];
}

export const selfHostedBuildMatrixPartitions: Readonly<Record<string, SelfHostedBuildMatrixPartitionDefinition>> =
  Object.freeze({
    'a-1': Object.freeze({
      multiServiceFixtureNames: Object.freeze([]),
      singleServiceFixtureNames: Object.freeze(['railpack', 'railpack-pnpm-workspace']),
    }),
    'a-2': Object.freeze({
      multiServiceFixtureNames: Object.freeze(['java-api-frontend']),
      singleServiceFixtureNames: Object.freeze(['dockerfile', 'dockerfile-monorepo', 'python']),
    }),
    'b-1': Object.freeze({
      multiServiceFixtureNames: Object.freeze(['multi-service']),
      singleServiceFixtureNames: Object.freeze(['railpack-monorepo']),
    }),
    'b-2': Object.freeze({
      multiServiceFixtureNames: Object.freeze([]),
      singleServiceFixtureNames: Object.freeze(['railpack-build-packages', 'static-poison']),
    }),
    'b-3': Object.freeze({
      multiServiceFixtureNames: Object.freeze([]),
      singleServiceFixtureNames: Object.freeze(['vite-react', 'static-vite-react']),
    }),
    gvisor: Object.freeze({
      multiServiceFixtureNames: Object.freeze([]),
      singleServiceFixtureNames: Object.freeze(['dockerfile']),
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
