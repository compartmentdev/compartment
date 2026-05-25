import { buildPublishedSelfHostedRuntimeSelection } from './self-hosted-env';
import { readSelfHostedEnvironmentValues, readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';
import { readMigratedNodeAgentSocketPath, readMigratedSystemApiSocketPath } from './self-hosted-host-socket-paths';
import { readCliBuildInfo } from './cli-build-info';
import { decideSelfHostedUpdateAction } from './update-version';
import type { CliBuildInfo } from './cli-build-info.types';
import type { InstallImageSource } from './install.types';
import type { SelfHostedInstallState } from './self-hosted-install-state.types';
import type { SelfHostedRuntimeSelection } from './self-hosted-env.types';
import type {
  SelfHostedUpdateInput,
  PreparedSelfHostedUpdateDecisionContext,
  PreparedSelfHostedUpdateEnvironment,
} from './update.types';
import type { SelfHostedUpdateDecision } from './update-version.types';

interface MigratedHostSocketEnvironment {
  migrationRequired: boolean;
  values: Record<string, string>;
}

export function createPreparedSelfHostedUpdateDecisionContext(
  input: SelfHostedUpdateInput,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
): PreparedSelfHostedUpdateDecisionContext {
  const environmentValues: Record<string, string> = readSelfHostedEnvironmentValues(
    preparedEnvironment.currentEnvironmentText,
  );
  const currentVersion: string = readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_NODE_VERSION');
  const migratedEnvironment: MigratedHostSocketEnvironment = readMigratedHostSocketEnvironment(environmentValues);
  const requestedRuntimeSelection: SelfHostedRuntimeSelection = buildPublishedSelfHostedRuntimeSelection(
    input.options.version,
  );
  const updateDecision: SelfHostedUpdateDecision = readPreparedSelfHostedUpdateDecision(
    preparedEnvironment,
    currentVersion,
    requestedRuntimeSelection,
  );

  return createPreparedUpdateDecisionContext(
    currentVersion,
    migratedEnvironment.values,
    requestedRuntimeSelection,
    updateDecision,
    migratedEnvironment.migrationRequired,
  );
}

export function shouldSkipPreparedSelfHostedUpdate(preparedContext: PreparedSelfHostedUpdateDecisionContext): boolean {
  if (preparedContext.updateDecision.action !== 'skip') {
    return false;
  }

  return preparedContext.updateDecision.reason !== 'already-current' || !preparedContext.environmentMigrationRequired;
}

export function assertRegistryUpdateMatchesPackagedNodeAgent(
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  preparedContext: PreparedSelfHostedUpdateDecisionContext,
): void {
  if (preparedEnvironment.imageSource !== 'registry') {
    return;
  }

  const cliBuildInfo: CliBuildInfo = readCliBuildInfo();
  const packagedRuntimeVersion: string = cliBuildInfo.defaultRegistryImageTag;
  if (preparedContext.runtimeSelection.nodeVersion === packagedRuntimeVersion) {
    return;
  }

  throw new Error(
    'Host node-agent must come from the same packaged compartment CLI as the selected runtime version. Install the matching CLI first or omit --version.',
  );
}

export function resolveSelfHostedUpdateImageSource(
  requestedImageSource: InstallImageSource | undefined,
  currentState: SelfHostedInstallState,
): InstallImageSource {
  if (requestedImageSource !== undefined) {
    return requestedImageSource;
  }

  return currentState.imageSource;
}

function readMigratedHostSocketEnvironment(environmentValues: Record<string, string>): MigratedHostSocketEnvironment {
  const nodeAgentSocketPath: string = readMigratedNodeAgentSocketPath(environmentValues);
  const systemApiSocketPath: string = readMigratedSystemApiSocketPath(environmentValues);

  return {
    migrationRequired:
      environmentValues.COMPARTMENT_NODE_AGENT_SOCKET !== nodeAgentSocketPath ||
      environmentValues.COMPARTMENT_SYSTEM_API_SOCKET !== systemApiSocketPath,
    values: {
      ...environmentValues,
      COMPARTMENT_NODE_AGENT_SOCKET: nodeAgentSocketPath,
      COMPARTMENT_SYSTEM_API_SOCKET: systemApiSocketPath,
    },
  };
}

function createPreparedUpdateDecisionContext(
  currentVersion: string,
  environmentValues: Record<string, string>,
  runtimeSelection: SelfHostedRuntimeSelection,
  updateDecision: SelfHostedUpdateDecision,
  environmentMigrationRequired: boolean,
): PreparedSelfHostedUpdateDecisionContext {
  return {
    currentVersion,
    environmentMigrationRequired,
    environmentValues,
    runtimeSelection,
    updateDecision,
  };
}

function readPreparedSelfHostedUpdateDecision(
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  currentVersion: string,
  runtimeSelection: SelfHostedRuntimeSelection,
): SelfHostedUpdateDecision {
  return decideSelfHostedUpdateAction({
    currentImageSource: preparedEnvironment.currentState.imageSource,
    currentVersion,
    targetImageSource: preparedEnvironment.imageSource,
    targetVersion: runtimeSelection.nodeVersion,
  });
}
