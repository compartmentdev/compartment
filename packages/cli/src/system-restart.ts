import { systemRestartResponseSchema, type SystemRestartResponse } from '@compartment/contracts';
import { ensureSelfHostedDockerExecutionContext } from './self-hosted-docker-context';
import { ensureSelfHostedRuntimeDirectories } from './self-hosted-runtime-directories';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import { assertSelfHostedSystemPrivileges } from './self-hosted-system-privileges';
import { readRequiredSelfHostedInstall } from './self-hosted-install-read';
import { readSelfHostedImageRefsFromEnvironmentText } from './self-hosted-env';
import { restartNodeAgentHostService, waitForNodeAgentHostServiceHealth } from './node-agent-service';
import type { ReadSelfHostedInstallResult } from './self-hosted-install-read.types';
import { readSelfHostedSystemServiceNames, restartSelfHostedSystemRuntime } from './docker-runtime';
import { readInheritedDockerProgressReportOptions } from './docker-progress';
import type { DockerExecutionContext } from './docker-runtime.types';
import type { InstallProgressReportOptions } from './install.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type { SelfHostedSystemInput, SelfHostedSystemRestartResult } from './system.types';

export async function restartSelfHostedSystem(input: SelfHostedSystemInput): Promise<SelfHostedSystemRestartResult> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  assertSelfHostedSystemPrivileges();
  const install: ReadSelfHostedInstallResult = await readRequiredSelfHostedInstall(paths);
  const dockerContext: DockerExecutionContext = await ensureSelfHostedDockerExecutionContext(input.context);

  await restartPreparedSelfHostedSystem(input, install, dockerContext);

  return systemRestartResponseSchema.parse(createSystemRestartResponse(paths.configDir, paths.dataDir));
}

async function restartPreparedSelfHostedSystem(
  input: SelfHostedSystemInput,
  install: ReadSelfHostedInstallResult,
  dockerContext: DockerExecutionContext,
): Promise<void> {
  await prepareRestartRuntimeDirectories(input);
  await restartSystemNodeAgent(input, install);
  await restartSystemRuntime(input, install, dockerContext);
  await waitForRestartedNodeAgent(input, install);
}

async function prepareRestartRuntimeDirectories(input: SelfHostedSystemInput): Promise<void> {
  reportRestartProgress(input, 'Preparing self-hosted runtime directories...');
  await ensureSelfHostedRuntimeDirectories();
}

async function restartSystemNodeAgent(
  input: SelfHostedSystemInput,
  install: ReadSelfHostedInstallResult,
): Promise<void> {
  reportRestartProgress(input, 'Restarting node agent service...');
  await restartNodeAgentHostService({
    envPath: install.installPaths.stagedAssetPaths.envPath,
    waitForHealth: false,
  });
}

async function restartSystemRuntime(
  input: SelfHostedSystemInput,
  install: ReadSelfHostedInstallResult,
  dockerContext: DockerExecutionContext,
): Promise<void> {
  reportRestartProgress(
    input,
    'Restarting self-hosted runtime...',
    readInheritedDockerProgressReportOptions(dockerContext),
  );
  await restartSelfHostedSystemRuntime(dockerContext, {
    composePath: install.installPaths.stagedAssetPaths.composePath,
    envPath: install.installPaths.stagedAssetPaths.envPath,
    imageRefs: readSelfHostedImageRefsFromEnvironmentText(install.environmentText),
    imageSource: install.state.imageSource,
    installDirectory: install.installPaths.configDir,
    localComposePath: install.installPaths.stagedAssetPaths.localComposePath,
    reportProgress: input.context?.reportProgress,
  });
}

async function waitForRestartedNodeAgent(
  input: SelfHostedSystemInput,
  install: ReadSelfHostedInstallResult,
): Promise<void> {
  reportRestartProgress(input, 'Waiting for node agent service...');
  await waitForNodeAgentHostServiceHealth({
    envPath: install.installPaths.stagedAssetPaths.envPath,
  });
}

function createSystemRestartResponse(configDir: string, dataDir: string): SystemRestartResponse {
  return {
    configDir,
    dataDir,
    restartedAt: new Date().toISOString(),
    services: [...readSelfHostedSystemServiceNames()],
  };
}

function reportRestartProgress(
  input: SelfHostedSystemInput,
  message: string,
  options?: InstallProgressReportOptions,
): void {
  input.context?.reportProgress?.(message, options);
}
