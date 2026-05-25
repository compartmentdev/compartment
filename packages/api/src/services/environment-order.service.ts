import { defaultCompartmentEnvironmentName } from '@compartment/contracts';

export function compareEnvironmentNames(left: string, right: string): number {
  const environmentRankComparison: number = readEnvironmentSortRank(left) - readEnvironmentSortRank(right);
  if (environmentRankComparison !== 0) {
    return environmentRankComparison;
  }

  return left.localeCompare(right);
}

export function readEnvironmentSortRank(environmentName: string): number {
  return environmentName === defaultCompartmentEnvironmentName ? 0 : 1;
}
