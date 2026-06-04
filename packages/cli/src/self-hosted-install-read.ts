import { readFile } from 'node:fs/promises';
import { assertSelfHostedGeneratedSecretEnvironment, isMissingFileSystemEntryError } from '@compartment/utils';
import { buildSelfHostedInstallPaths } from './self-hosted-install-paths';
import { readRequiredSelfHostedEnvironmentValue, readSelfHostedEnvironmentValues } from './self-hosted-env-file';
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
  const environmentValues: Record<string, string> = readSelfHostedEnvironmentValues(environmentText);
  assertSelfHostedInstallEnvironment(environmentValues);
  assertSelfHostedGeneratedSecretEnvironment(environmentValues);

  return {
    environmentText,
    installPaths,
    state,
  };
}

function assertSelfHostedInstallEnvironment(environmentValues: Record<string, string>): void {
  const compartmentEnv: string = readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_ENV');
  if (compartmentEnv !== 'self-hosted') {
    throw new Error(
      `The self-hosted environment has an invalid COMPARTMENT_ENV value: ${compartmentEnv}. Expected self-hosted.`,
    );
  }
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
