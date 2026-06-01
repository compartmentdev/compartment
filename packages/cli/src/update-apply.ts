import { ensureSelfHostedDockerExecutionContext } from './self-hosted-docker-context';
import { writeSelfHostedPrivateFile } from './self-hosted-file-permissions';
import { backupSelfHostedInstallFiles } from './self-hosted-install-backup';
import { writeSelfHostedInstallState } from './self-hosted-install-state';
import { prepareSelfHostedRuntimeImages, restartSelfHostedRuntime, stopSelfHostedRuntime } from './docker-runtime';
import { readInheritedDockerProgressReportOptions } from './docker-progress';
import {
  restartNodeAgentHostService,
  stageNodeAgentHostService,
  stopNodeAgentHostService,
  waitForNodeAgentHostServiceHealth,
} from './node-agent-service';
import {
  assertNodeAgentRuntimeNetworkReconcileEnvironment,
  reconcileNodeAgentRuntimeNetworks,
} from './node-agent-runtime-network';
import type { DockerExecutionContext, RestartSelfHostedRuntimeInput } from './docker-runtime.types';
import type { InstallContext, InstallProgressReporter, InstallProgressReportOptions } from './install.types';
import type { PreparedSelfHostedUpdate, SelfHostedUpdateInput, SelfHostedUpdateResult } from './update.types';
import { createAppliedSelfHostedUpdateResult, createUpdatedSelfHostedInstallState } from './update-result';
import { stageBundledAssets } from './runtime-assets';

export async function applyPreparedSelfHostedUpdate(
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
  await reconcileUpdatedRuntimeNetworks(input.context, preparedUpdate);

  return createAppliedSelfHostedUpdateResult(preparedUpdate, backupDir);
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
  await stopUpdatedRuntimeForPermissionRepair(dockerContext, context, preparedUpdate);
  reportUpdateProgress(context, 'Staging node agent service...');
  await stageNodeAgentHostService({
    envPath: preparedUpdate.stagedAssetPaths.envPath,
    repairRuntimeWritableDirectoryContents: true,
  });
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
}

async function restartUpdatedComposeRuntime(
  dockerContext: DockerExecutionContext,
  context: InstallContext | undefined,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<void> {
  await restartSelfHostedRuntime(dockerContext, {
    ...buildUpdatedRuntimeInput(preparedUpdate, context),
    skipRequiredImageVerificationBeforeStart: true,
  });
}

async function stopUpdatedRuntimeForPermissionRepair(
  dockerContext: DockerExecutionContext,
  context: InstallContext | undefined,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<void> {
  reportUpdateProgress(context, 'Stopping self-hosted runtime for permission repair...');
  await stopSelfHostedRuntime(dockerContext, buildUpdatedRuntimeInput(preparedUpdate, context));
  reportUpdateProgress(context, 'Stopping node agent service for permission repair...');
  await stopNodeAgentHostService();
}

function buildUpdatedRuntimeInput(
  preparedUpdate: PreparedSelfHostedUpdate,
  context: InstallContext | undefined,
): RestartSelfHostedRuntimeInput {
  return {
    composePath: preparedUpdate.stagedAssetPaths.composePath,
    envPath: preparedUpdate.stagedAssetPaths.envPath,
    imageRefs: preparedUpdate.runtimeSelection.imageRefs,
    imageSource: preparedUpdate.imageSource,
    installDirectory: preparedUpdate.configDir,
    localComposePath: preparedUpdate.stagedAssetPaths.localComposePath,
    reportProgress: context?.reportProgress,
  };
}

async function reconcileUpdatedRuntimeNetworks(
  context: InstallContext | undefined,
  preparedUpdate: PreparedSelfHostedUpdate,
): Promise<void> {
  reportUpdateProgress(context, 'Reconciling runtime network attachments...');
  await reconcileNodeAgentRuntimeNetworks({ environmentText: preparedUpdate.renderedEnvironment.text });
}

function reportUpdateProgress(
  context: InstallContext | undefined,
  message: string,
  options?: InstallProgressReportOptions,
): void {
  const reportProgress: InstallProgressReporter | undefined = context?.reportProgress;
  reportProgress?.(message, options);
}
