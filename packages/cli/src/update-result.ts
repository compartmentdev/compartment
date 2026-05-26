import type { UpdateSkipReason } from '@compartment/contracts';
import type { InstallImageSource } from './install.types';
import type { SelfHostedRuntimeImageRegistry } from './self-hosted-env.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type { SelfHostedInstallState } from './self-hosted-install-state.types';
import type { SelfHostedUpdateResult, PreparedSelfHostedUpdate, SkippedSelfHostedUpdate } from './update.types';

export function createUpdatedSelfHostedInstallState(
  preparedUpdate: PreparedSelfHostedUpdate,
  currentState: SelfHostedInstallState,
): SelfHostedInstallState {
  return {
    imageRegistry: preparedUpdate.imageRegistry,
    imageSource: preparedUpdate.imageSource,
    installationId: currentState.installationId,
    ...(currentState.managedDomain === undefined ? {} : { managedDomain: currentState.managedDomain }),
    stateVersion: 1,
  };
}

export function createAppliedSelfHostedUpdateResult(
  preparedUpdate: PreparedSelfHostedUpdate,
  backupDir: string,
): SelfHostedUpdateResult {
  return {
    backupDir,
    configDir: preparedUpdate.configDir,
    currentVersion: preparedUpdate.currentVersion,
    dataDir: preparedUpdate.dataDir,
    imageRegistry: preparedUpdate.imageRegistry,
    imageSource: preparedUpdate.imageSource,
    skipReason: null,
    status: 'updated',
    targetVersion: preparedUpdate.targetVersion,
  };
}

export function createSkippedSelfHostedUpdateResult(preparedUpdate: SkippedSelfHostedUpdate): SelfHostedUpdateResult {
  return {
    backupDir: null,
    configDir: preparedUpdate.configDir,
    currentVersion: preparedUpdate.currentVersion,
    dataDir: preparedUpdate.dataDir,
    imageRegistry: preparedUpdate.imageRegistry,
    imageSource: preparedUpdate.imageSource,
    skipReason: preparedUpdate.skipReason,
    status: 'skipped',
    targetVersion: preparedUpdate.targetVersion,
  };
}

export function createSkippedPreparedSelfHostedUpdate(
  paths: SelfHostedPathSelection,
  currentState: SelfHostedInstallState,
  currentVersion: string,
  targetVersion: string,
  imageRegistry: SelfHostedRuntimeImageRegistry,
  imageSource: InstallImageSource,
  skipReason: UpdateSkipReason,
): SkippedSelfHostedUpdate {
  return {
    configDir: paths.configDir,
    currentState,
    currentVersion,
    dataDir: paths.dataDir,
    imageRegistry,
    imageSource,
    skipReason,
    targetVersion,
    updateAction: 'skip',
  };
}
