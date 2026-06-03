import type { UpdateSkipReason } from '@compartment/contracts';
import { readRequiredSelfHostedInstallForUpdate } from './self-hosted-install-read';
import type { ReadSelfHostedInstallForUpdateResult } from './self-hosted-install-read.types';
import { assertSelfHostedSystemPrivileges } from './self-hosted-system-privileges';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import { assertNodeAgentHostServiceInstallable } from './node-agent-service';
import type { InstallImageSource } from './install.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type { SelfHostedRuntimeSelection, RenderedSelfHostedEnvironment } from './self-hosted-env.types';
import { readBundledAssets } from './runtime-assets';
import type { BundledAssets } from './runtime-assets.types';
import { buildRenderedSelfHostedUpdateEnvironment } from './update-environment';
import { createSkippedSelfHostedUpdateResult, createSkippedPreparedSelfHostedUpdate } from './update-result';
import { applyPreparedSelfHostedUpdate } from './update-apply';
import {
  assertRegistryUpdateMatchesPackagedNodeAgent,
  createPreparedSelfHostedUpdateDecisionContext,
  resolveSelfHostedUpdateImageRegistry,
  resolveSelfHostedUpdateImageSource,
} from './update-decision';
import type {
  SelfHostedUpdateInput,
  SelfHostedUpdateResult,
  PreparedSelfHostedUpdate,
  PreparedSelfHostedUpdateDecisionContext,
  PreparedSelfHostedUpdateEnvironment,
  PreparedSelfHostedUpdatePlan,
} from './update.types';

export async function updateSelfHosted(input: SelfHostedUpdateInput): Promise<SelfHostedUpdateResult> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  assertNodeAgentHostServiceInstallable();
  assertSelfHostedSystemPrivileges();
  const preparedUpdate: PreparedSelfHostedUpdatePlan = await prepareSelfHostedUpdate(input, paths);
  if (preparedUpdate.updateAction === 'skip') {
    return finishSkippedSelfHostedUpdate(preparedUpdate);
  }

  return await applyPreparedSelfHostedUpdate(input, preparedUpdate);
}

function finishSkippedSelfHostedUpdate(preparedUpdate: PreparedSelfHostedUpdatePlan): SelfHostedUpdateResult {
  if (preparedUpdate.updateAction !== 'skip') {
    throw new Error('Expected skipped self-hosted update.');
  }

  return createSkippedSelfHostedUpdateResult(preparedUpdate);
}

async function prepareSelfHostedUpdate(
  input: SelfHostedUpdateInput,
  paths: SelfHostedPathSelection,
): Promise<PreparedSelfHostedUpdatePlan> {
  const preparedEnvironment: PreparedSelfHostedUpdateEnvironment = await readPreparedSelfHostedUpdateEnvironment(
    input,
    paths,
  );
  const assetPaths: BundledAssets = readBundledAssets(input.context?.packageDirectory ?? __dirname);
  const preparedContext: PreparedSelfHostedUpdateDecisionContext = createPreparedSelfHostedUpdateDecisionContext(
    input,
    preparedEnvironment,
  );
  assertRegistryUpdateMatchesPackagedNodeAgent(preparedEnvironment, preparedContext);

  return await createPreparedSelfHostedUpdatePlanFromContext(paths, preparedEnvironment, assetPaths, preparedContext);
}

async function createPreparedSelfHostedUpdatePlanFromContext(
  paths: SelfHostedPathSelection,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  assetPaths: BundledAssets,
  preparedContext: PreparedSelfHostedUpdateDecisionContext,
): Promise<PreparedSelfHostedUpdatePlan> {
  const renderedEnvironment: RenderedSelfHostedEnvironment = await renderPreparedSelfHostedUpdateEnvironment(
    assetPaths,
    preparedEnvironment,
    preparedContext,
  );

  return createPreparedSelfHostedUpdatePlanFromRenderedEnvironment(
    paths,
    preparedEnvironment,
    assetPaths,
    preparedContext,
    renderedEnvironment,
  );
}

function createPreparedSelfHostedUpdatePlanFromRenderedEnvironment(
  paths: SelfHostedPathSelection,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  assetPaths: BundledAssets,
  preparedContext: PreparedSelfHostedUpdateDecisionContext,
  renderedEnvironment: RenderedSelfHostedEnvironment,
): PreparedSelfHostedUpdatePlan {
  const skipReason: UpdateSkipReason | null = readPreparedSelfHostedUpdateSkipReason(
    preparedEnvironment,
    preparedContext,
    renderedEnvironment,
  );
  if (skipReason !== null) {
    return createPreparedSkippedSelfHostedUpdatePlan(paths, preparedEnvironment, preparedContext, skipReason);
  }

  return createPreparedAppliedSelfHostedUpdateResult(
    paths,
    preparedEnvironment,
    assetPaths,
    preparedContext.currentVersion,
    renderedEnvironment,
    preparedContext.runtimeSelection,
  );
}

function readPreparedSelfHostedUpdateSkipReason(
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  preparedContext: PreparedSelfHostedUpdateDecisionContext,
  renderedEnvironment: RenderedSelfHostedEnvironment,
): UpdateSkipReason | null {
  if (preparedContext.updateDecision.action !== 'skip') {
    return null;
  }

  return shouldSkipPreparedSelfHostedUpdate(
    preparedEnvironment,
    renderedEnvironment,
    preparedContext.updateDecision.reason,
  )
    ? preparedContext.updateDecision.reason
    : null;
}

async function renderPreparedSelfHostedUpdateEnvironment(
  assetPaths: BundledAssets,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  preparedContext: PreparedSelfHostedUpdateDecisionContext,
): Promise<RenderedSelfHostedEnvironment> {
  return await buildRenderedSelfHostedUpdateEnvironment(
    assetPaths,
    preparedContext.environmentValues,
    preparedEnvironment.stagedAssetPaths.dockerWorkDirectory,
    preparedContext.runtimeSelection,
    preparedEnvironment.currentState.managedDomain,
  );
}

function createPreparedAppliedSelfHostedUpdateResult(
  paths: SelfHostedPathSelection,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  assetPaths: BundledAssets,
  currentVersion: string,
  renderedEnvironment: RenderedSelfHostedEnvironment,
  runtimeSelection: SelfHostedRuntimeSelection,
): PreparedSelfHostedUpdate {
  return {
    assetPaths,
    configDir: paths.configDir,
    currentState: preparedEnvironment.currentState,
    currentVersion,
    dataDir: paths.dataDir,
    imageRegistry: preparedEnvironment.imageRegistry,
    imageSource: preparedEnvironment.imageSource,
    installPaths: preparedEnvironment.installPaths,
    paths,
    renderedEnvironment,
    runtimeSelection,
    stagedAssetPaths: preparedEnvironment.stagedAssetPaths,
    targetVersion: runtimeSelection.nodeVersion,
    updateAction: 'apply',
  };
}

function shouldSkipPreparedSelfHostedUpdate(
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  renderedEnvironment: RenderedSelfHostedEnvironment,
  skipReason: UpdateSkipReason,
): boolean {
  if (skipReason !== 'already-current') {
    return true;
  }

  return renderedEnvironment.text === preparedEnvironment.currentEnvironmentText;
}

async function readPreparedSelfHostedUpdateEnvironment(
  input: SelfHostedUpdateInput,
  paths: SelfHostedPathSelection,
): Promise<PreparedSelfHostedUpdateEnvironment> {
  const install: ReadSelfHostedInstallForUpdateResult = await readRequiredSelfHostedInstallForUpdate(paths);
  const imageSource: InstallImageSource = resolveSelfHostedUpdateImageSource(input.options.imageSource, install.state);

  return {
    currentEnvironmentText: install.environmentText,
    currentState: install.state,
    imageRegistry: resolveSelfHostedUpdateImageRegistry(input.options.imageRegistry, install.state, imageSource),
    imageSource,
    installPaths: install.installPaths,
    stagedAssetPaths: install.installPaths.stagedAssetPaths,
  };
}

function createPreparedSkippedSelfHostedUpdatePlan(
  paths: SelfHostedPathSelection,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  preparedContext: PreparedSelfHostedUpdateDecisionContext,
  skipReason: UpdateSkipReason,
): PreparedSelfHostedUpdatePlan {
  return createSkippedPreparedSelfHostedUpdate(
    paths,
    preparedEnvironment.currentState,
    preparedContext.currentVersion,
    preparedContext.runtimeSelection.nodeVersion,
    preparedEnvironment.imageRegistry,
    preparedEnvironment.imageSource,
    skipReason,
  );
}
