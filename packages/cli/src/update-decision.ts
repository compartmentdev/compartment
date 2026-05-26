import { buildPublishedSelfHostedRuntimeSelection } from './self-hosted-env';
import {
  legacySelfHostedRuntimeImageRegistry,
  resolveStoredSelfHostedRuntimeImageRegistry,
} from './self-hosted-runtime-selection';
import { readSelfHostedEnvironmentValues, readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';
import { readCanonicalNodeAgentSocketPath, readCanonicalSystemApiSocketPath } from './self-hosted-host-socket-paths';
import { readCliBuildInfo } from './cli-build-info';
import { decideSelfHostedUpdateAction } from './update-version';
import type { CliBuildInfo } from './cli-build-info.types';
import type { InstallImageSource } from './install.types';
import type { SelfHostedInstallState } from './self-hosted-install-state.types';
import type { SelfHostedRuntimeImageRegistry, SelfHostedRuntimeSelection } from './self-hosted-env.types';
import type {
  SelfHostedUpdateInput,
  PreparedSelfHostedUpdateDecisionContext,
  PreparedSelfHostedUpdateEnvironment,
} from './update.types';
import type { SelfHostedUpdateDecision } from './update-version.types';

interface CanonicalHostSocketEnvironment {
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
  const canonicalEnvironment: CanonicalHostSocketEnvironment = readCanonicalHostSocketEnvironment(environmentValues);
  const requestedRuntimeSelection: SelfHostedRuntimeSelection = buildPublishedSelfHostedRuntimeSelection(
    input.options.version,
    preparedEnvironment.imageRegistry,
  );
  return createPreparedUpdateDecisionContext(
    currentVersion,
    canonicalEnvironment.values,
    requestedRuntimeSelection,
    readPreparedSelfHostedUpdateDecision(input, preparedEnvironment, currentVersion, requestedRuntimeSelection),
  );
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

export function resolveSelfHostedUpdateImageRegistry(
  requestedImageRegistry: SelfHostedRuntimeImageRegistry | undefined,
  currentState: SelfHostedInstallState,
  targetImageSource: InstallImageSource,
): SelfHostedRuntimeImageRegistry {
  if (requestedImageRegistry !== undefined) {
    return requestedImageRegistry;
  }

  return resolveStoredSelfHostedRuntimeImageRegistry(currentState.imageRegistry, targetImageSource);
}

function readCanonicalHostSocketEnvironment(environmentValues: Record<string, string>): CanonicalHostSocketEnvironment {
  const nodeAgentSocketPath: string = readCanonicalNodeAgentSocketPath(environmentValues);
  const systemApiSocketPath: string = readCanonicalSystemApiSocketPath(environmentValues);

  return {
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
): PreparedSelfHostedUpdateDecisionContext {
  return {
    currentVersion,
    environmentValues,
    runtimeSelection,
    updateDecision,
  };
}

function readPreparedSelfHostedUpdateDecision(
  input: SelfHostedUpdateInput,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  currentVersion: string,
  runtimeSelection: SelfHostedRuntimeSelection,
): SelfHostedUpdateDecision {
  return decideSelfHostedUpdateAction({
    currentImageSource: preparedEnvironment.currentState.imageSource,
    currentImageRegistry: readCurrentSelfHostedUpdateImageRegistry(preparedEnvironment.currentState),
    currentImageRegistryRecorded: preparedEnvironment.currentState.imageRegistry !== undefined,
    currentVersion,
    targetImageSource: preparedEnvironment.imageSource,
    targetImageRegistry: preparedEnvironment.imageRegistry,
    targetImageRegistryRequested: input.options.imageRegistry !== undefined,
    targetVersion: runtimeSelection.nodeVersion,
  });
}

function readCurrentSelfHostedUpdateImageRegistry(
  currentState: SelfHostedInstallState,
): SelfHostedRuntimeImageRegistry {
  return currentState.imageRegistry ?? legacySelfHostedRuntimeImageRegistry;
}
