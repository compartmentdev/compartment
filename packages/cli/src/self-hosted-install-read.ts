import { readFile } from 'node:fs/promises';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { buildSelfHostedInstallPaths } from './self-hosted-install-paths';
import type { SelfHostedInstallPaths, SelfHostedPathSelection } from './self-hosted-install-paths.types';
import { readSelfHostedInstallStateFromInstallPaths } from './self-hosted-install-state';
import type { SelfHostedInstallState } from './self-hosted-install-state.types';
import type {
  ReadSelfHostedInstallForUpdateResult,
  ReadSelfHostedInstallResult,
} from './self-hosted-install-read.types';

export async function readRequiredSelfHostedInstallForUpdate(
  paths: SelfHostedPathSelection,
): Promise<ReadSelfHostedInstallForUpdateResult> {
  return await readRequiredSelfHostedInstall(paths);
}

export async function readRequiredSelfHostedInstall(
  paths: SelfHostedPathSelection,
): Promise<ReadSelfHostedInstallResult> {
  const installPaths: SelfHostedInstallPaths = buildSelfHostedInstallPaths(paths);
  const environmentText: string = await readRequiredSelfHostedEnvironmentText(installPaths.stagedAssetPaths.envPath);
  const state: SelfHostedInstallState | undefined = await readSelfHostedInstallStateFromInstallPaths(installPaths);
  if (state === undefined) {
    throw new Error(
      `Expected an existing self-hosted install state at ${installPaths.statePath}. Reinstall the runtime with \`compartment install\`.`,
    );
  }

  return {
    environmentText,
    installPaths,
    state,
  };
}

async function readRequiredSelfHostedEnvironmentText(environmentPath: string): Promise<string> {
  try {
    return await readFile(environmentPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      throw new Error(
        `Expected an existing self-hosted install environment at ${environmentPath}. Run \`compartment install\` first.`,
      );
    }

    throw error;
  }
}
