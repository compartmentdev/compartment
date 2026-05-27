import type { UpdateSkipReason } from '@compartment/contracts';
import { ensureSelfHostedDockerExecutionContext } from './self-hosted-docker-context';
import { writeSelfHostedPrivateFile } from './self-hosted-file-permissions';
import { backupSelfHostedInstallFiles } from './self-hosted-install-backup';
import { writeSelfHostedInstallState } from './self-hosted-install-state';
import { readRequiredSelfHostedInstallForUpdate } from './self-hosted-install-read';
import type { ReadSelfHostedInstallForUpdateResult } from './self-hosted-install-read.types';
import { assertSelfHostedSystemPrivileges } from './self-hosted-system-privileges';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import { prepareSelfHostedRuntimeImages, restartSelfHostedRuntime } from './docker-runtime';
import { readInheritedDockerProgressReportOptions } from './docker-progress';
import {
  assertNodeAgentHostServiceInstallable,
  restartNodeAgentHostService,
  stageNodeAgentHostService,
  waitForNodeAgentHostServiceHealth,
} from './node-agent-service';
import {
  assertNodeAgentRuntimeNetworkReconcileEnvironment,
  reconcileNodeAgentRuntimeNetworks,
} from './node-agent-runtime-network';
import type { DockerExecutionContext } from './docker-runtime.types';
import type {
  InstallContext,
  InstallImageSource,
  InstallProgressReporter,
  InstallProgressReportOptions,
} from './install.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type { SelfHostedRuntimeSelection, RenderedSelfHostedEnvironment } from './self-hosted-env.types';
import { readBundledAssets, stageBundledAssets } from './runtime-assets';
import type { BundledAssets } from './runtime-assets.types';
import { buildRenderedSelfHostedUpdateEnvironment } from './update-environment';
import {
  createAppliedSelfHostedUpdateResult,
  createSkippedSelfHostedUpdateResult,
  createSkippedPreparedSelfHostedUpdate,
  createUpdatedSelfHostedInstallState,
} from './update-result';
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

async function applyPreparedSelfHostedUpdate(
  input: SelfHostedUpdateInput,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<SelfHostedUpdateResult> {
  assertNodeAgentRuntimeNetworkReconcileEnvironment(preparedUpdate.renderedEnvironment.text);
  const dockerContext: DockerExecutionContext = await ensureSelfHostedDockerExecutionContext(input.context);

  await prepareUpdatedSelfHostedRuntimeImages(dockerContext, input.context, preparedUpdate);
  const backupDir: string = await backupSelfHostedInstallFiles(preparedUpdate.installPaths);
  await stageUpdatedSelfHostedRuntime(input.context, preparedUpdate);
  await restartUpdatedSelfHostedRuntime(dockerContext, input.context, preparedUpdate);
  await writeSelfHostedInstallState(
    preparedUpdate.paths,
    createUpdatedSelfHostedInstallState(preparedUpdate, preparedUpdate.currentState),
    preparedUpdate.installPaths,
  );

  return createAppliedSelfHostedUpdateResult(preparedUpdate, backupDir);
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
  if (preparedContext.updateDecision.action === 'skip') {
    return createPreparedSkippedSelfHostedUpdatePlan(
      paths,
      preparedEnvironment,
      preparedContext,
      preparedContext.updateDecision.reason,
    );
  }

  return await createPreparedAppliedSelfHostedUpdate(paths, preparedEnvironment, assetPaths, preparedContext);
}

async function createPreparedAppliedSelfHostedUpdate(
  paths: SelfHostedPathSelection,
  preparedEnvironment: PreparedSelfHostedUpdateEnvironment,
  assetPaths: BundledAssets,
  preparedContext: PreparedSelfHostedUpdateDecisionContext,
): Promise<PreparedSelfHostedUpdate> {
  const renderedEnvironment: RenderedSelfHostedEnvironment = await buildRenderedSelfHostedUpdateEnvironment(
    assetPaths,
    preparedContext.environmentValues,
    preparedEnvironment.stagedAssetPaths.dockerWorkDirectory,
    preparedContext.runtimeSelection,
    preparedEnvironment.currentState.managedDomain,
  );

  return createPreparedAppliedSelfHostedUpdateResult(
    paths,
    preparedEnvironment,
    assetPaths,
    preparedContext.currentVersion,
    renderedEnvironment,
    preparedContext.runtimeSelection,
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

async function stageUpdatedSelfHostedRuntime(
  context: InstallContext | undefined,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<void> {
  reportUpdateProgress(context, 'Staging updated self-hosted runtime assets...');
  await stageBundledAssets(preparedUpdate.stagedAssetPaths, preparedUpdate.assetPaths);
  await writeSelfHostedPrivateFile(preparedUpdate.stagedAssetPaths.envPath, preparedUpdate.renderedEnvironment.text);
}

async function restartUpdatedSelfHostedRuntime(
  dockerContext: DockerExecutionContext,
  context: InstallContext | undefined,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<void> {
  reportUpdateProgress(context, 'Staging node agent service...');
  await stageNodeAgentHostService({ envPath: preparedUpdate.stagedAssetPaths.envPath });
  // systemd recreates RuntimeDirectory on agent restart; do it before Docker binds the socket directory.
  reportUpdateProgress(context, 'Restarting node agent service...');
  await restartNodeAgentHostService({ envPath: preparedUpdate.stagedAssetPaths.envPath, waitForHealth: false });
  reportUpdateProgress(
    context,
    'Restarting self-hosted runtime...',
    readInheritedDockerProgressReportOptions(dockerContext),
  );
  await restartUpdatedComposeRuntime(dockerContext, context, preparedUpdate);
  reportUpdateProgress(context, 'Waiting for node agent service...');
  await waitForNodeAgentHostServiceHealth({ envPath: preparedUpdate.stagedAssetPaths.envPath });
  reportUpdateProgress(context, 'Reconciling runtime network attachments...');
  await reconcileNodeAgentRuntimeNetworks({ environmentText: preparedUpdate.renderedEnvironment.text });
}

async function prepareUpdatedSelfHostedRuntimeImages(
  dockerContext: DockerExecutionContext,
  context: InstallContext | undefined,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<void> {
  reportUpdateProgress(context, 'Preparing runtime images...', readInheritedDockerProgressReportOptions(dockerContext));
  await prepareSelfHostedRuntimeImages(dockerContext, {
    composePath: preparedUpdate.stagedAssetPaths.composePath,
    envPath: preparedUpdate.stagedAssetPaths.envPath,
    imageRefs: preparedUpdate.runtimeSelection.imageRefs,
    imageSource: preparedUpdate.imageSource,
    installDirectory: preparedUpdate.configDir,
    localComposePath: preparedUpdate.stagedAssetPaths.localComposePath,
    reportProgress: context?.reportProgress,
  });
}

async function restartUpdatedComposeRuntime(
  dockerContext: DockerExecutionContext,
  context: InstallContext | undefined,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<void> {
  await restartSelfHostedRuntime(dockerContext, {
    composePath: preparedUpdate.stagedAssetPaths.composePath,
    envPath: preparedUpdate.stagedAssetPaths.envPath,
    imageRefs: preparedUpdate.runtimeSelection.imageRefs,
    imageSource: preparedUpdate.imageSource,
    installDirectory: preparedUpdate.configDir,
    localComposePath: preparedUpdate.stagedAssetPaths.localComposePath,
    reportProgress: context?.reportProgress,
    skipRequiredImageVerificationBeforeStart: true,
  });
}

function reportUpdateProgress(
  context: InstallContext | undefined,
  message: string,
  options?: InstallProgressReportOptions,
): void {
  const reportProgress: InstallProgressReporter | undefined = context?.reportProgress;
  reportProgress?.(message, options);
}
