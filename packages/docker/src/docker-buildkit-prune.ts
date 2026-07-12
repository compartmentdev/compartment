import { readBuildKitAddress, runBuildctlCommandWithRegistryRetry } from './buildkit-command';
import { buildBuildKitPruneArgs } from './docker-buildkit-args';

export async function pruneBuildKitCache(): Promise<void> {
  const buildKitAddress: string | null = readBuildKitAddress();
  if (buildKitAddress === null) {
    throw new Error('BUILDKIT_ADDR is required for remote BuildKit cache pruning.');
  }

  await runBuildctlCommandWithRegistryRetry(buildBuildKitPruneArgs(buildKitAddress));
}
