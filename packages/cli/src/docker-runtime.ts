import type { SystemServiceName } from '@compartment/contracts';
import type { CommandResult } from './command-runner.types';
import { runDockerCommand } from './docker-command';
import { ensureDockerExecutionContext } from './docker-execution-context';
import { areCoreRuntimeServicesAvailable } from './docker-runtime-availability';
import { buildComposeUpArguments, createCommandError, createCommandWarning } from './docker-runtime-compose';
import { recoverAvailableSelfHostedRuntimeServicesAfterComposeStartError } from './docker-runtime-compose-start-recovery';
import { readMissingSelfHostedRuntimeImageRefs, usesMutableRegistryImageTag } from './docker-runtime-image-refs';
import {
  pullVerifiedRegistryRuntimeImages,
  verifyBuildRuntimeImagesBeforeStart,
  verifyLocalRuntimeProbeImageAvailable,
  verifyLocalBuildRuntimeImages,
  verifyRequiredRuntimeImagesBeforeStart,
} from './docker-runtime-image-verification';
import { inspectSelfHostedRuntimeServices } from './docker-runtime.inspect';
import {
  createSelfHostedRuntimeImageSignatureWarning,
  verifyLocalSelfHostedRuntimeImageSignatures,
} from './docker-runtime-signature';
import {
  selfHostedBuildRuntimeServiceNames,
  selfHostedCoreRuntimeServiceNames,
  selfHostedRequiredSystemComposeServiceNames,
  readSelfHostedSystemServiceNames,
} from './docker-runtime.service-names';
import type { SelfHostedImageRefs } from './self-hosted-env.types';
import type {
  DockerExecutionContext,
  PrepareSelfHostedRuntimeImagesInput,
  RestartSelfHostedRuntimeInput,
  StartSelfHostedRuntimeInput,
} from './docker-runtime.types';

const buildServicesUnavailableMessage: string =
  'Build worker services did not become healthy. The control plane remains running; source builds will stay unavailable until the builder starts.';
const buildImagesUnavailableMessage: string =
  'Build worker images could not be pulled. The control plane can still start; source builds may stay unavailable until builder and worker images are available.';
const requiredServiceComposeStartRecoveryMessage: string =
  'Docker Compose reported a transient start error after required services became available.';
const buildServiceComposeStartRecoveryMessage: string =
  'Docker Compose reported a transient build-service start error after services became available.';

export { ensureDockerExecutionContext, inspectSelfHostedRuntimeServices, readSelfHostedSystemServiceNames };
export { stopSelfHostedRuntime } from './docker-runtime-stop';

export async function prepareSelfHostedRuntimeImages(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
): Promise<void> {
  if (input.imageSource === 'local') {
    await verifyLocalRuntimeProbeImageAvailable(context, input);
    return;
  }

  const pullResult: CommandResult | null = await pullSelfHostedCoreRuntimeImages(context, input);
  if (pullResult === null || (await didPullSelfHostedRuntimeImagesSucceed(context, input.imageRefs, pullResult))) {
    await verifyLocalSelfHostedCoreRuntimeImages(context, input);
    await pullSelfHostedBuildRuntimeImages(context, input);
    return;
  }
  throw createCommandError('Failed to pull self-hosted images.', pullResult);
}

async function pullSelfHostedCoreRuntimeImages(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
): Promise<CommandResult | null> {
  return await pullVerifiedRegistryRuntimeImages(context, input, selfHostedCoreRuntimeServiceNames, true, true);
}

async function verifyLocalSelfHostedCoreRuntimeImages(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
): Promise<void> {
  await verifyLocalSelfHostedRuntimeImageSignatures({
    context,
    includeRuntimeProbeImage: true,
    imageRefs: input.imageRefs,
    services: selfHostedCoreRuntimeServiceNames,
  });
}

export async function startSelfHostedRuntime(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
): Promise<void> {
  await startRequiredSelfHostedRuntimeServices(
    context,
    input,
    false,
    selfHostedCoreRuntimeServiceNames,
    'Failed to start self-hosted runtime.',
  );
  await startBuildSelfHostedRuntimeServices(context, input, false);
}

export async function restartSelfHostedRuntime(
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
): Promise<void> {
  await startRequiredSelfHostedRuntimeServices(
    context,
    input,
    true,
    selfHostedCoreRuntimeServiceNames,
    'Failed to restart self-hosted runtime.',
  );
  await startBuildSelfHostedRuntimeServices(context, input, true);
}

export async function restartSelfHostedSystemRuntime(
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
): Promise<void> {
  await startRequiredSelfHostedRuntimeServices(
    context,
    input,
    true,
    selfHostedRequiredSystemComposeServiceNames,
    'Failed to restart self-hosted platform.',
  );
  await startBuildSelfHostedRuntimeServices(context, input, true);
}

async function startRequiredSelfHostedRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  isRestart: boolean,
  services: readonly SystemServiceName[],
  errorPrefix: string,
): Promise<void> {
  const pullMissingRegistryImages: boolean = isRestart;
  if (input.skipRequiredImageVerificationBeforeStart !== true) {
    await verifyRequiredRuntimeImagesBeforeStart(context, input, services, pullMissingRegistryImages, true);
  }
  const upResult: CommandResult = await runRuntimeComposeUp(context, input, isRestart, services);
  if (upResult.exitCode === 0 || (await recoverStartedRequiredRuntimeServices(context, input, upResult, services))) {
    return;
  }

  throw createCommandError(errorPrefix, upResult);
}

async function recoverStartedRequiredRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  upResult: CommandResult,
  services: readonly SystemServiceName[],
): Promise<boolean> {
  return await recoverAvailableSelfHostedRuntimeServicesAfterComposeStartError(
    context,
    input,
    upResult,
    services,
    requiredServiceComposeStartRecoveryMessage,
  );
}

async function startBuildSelfHostedRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  isRestart: boolean,
): Promise<void> {
  if (!(await canStartBuildRuntimeServices(context, input, isRestart))) {
    return;
  }

  const upResult: CommandResult = await runRuntimeComposeUp(
    context,
    input,
    isRestart,
    selfHostedBuildRuntimeServiceNames,
  );
  if (upResult.exitCode === 0 || (await recoverStartedBuildRuntimeServices(context, input, upResult))) {
    return;
  }

  await reportBuildServiceStartFailure(context, input, upResult);
}

async function canStartBuildRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  isRestart: boolean,
): Promise<boolean> {
  return await verifyBuildRuntimeImagesBeforeStart(context, input, isRestart);
}

async function recoverStartedBuildRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  upResult: CommandResult,
): Promise<boolean> {
  return await recoverAvailableSelfHostedRuntimeServicesAfterComposeStartError(
    context,
    input,
    upResult,
    selfHostedBuildRuntimeServiceNames,
    buildServiceComposeStartRecoveryMessage,
  );
}

async function runRuntimeComposeUp(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  isRestart: boolean,
  services: readonly SystemServiceName[],
): Promise<CommandResult> {
  return await runDockerCommand(context, buildComposeUpArguments(input, isRestart, services));
}

async function reportBuildServiceStartFailure(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  upResult: CommandResult,
): Promise<void> {
  let areCoreServicesAvailable: boolean;
  try {
    areCoreServicesAvailable = await areCoreRuntimeServicesAvailable(context, input);
  } catch {
    throw createCommandError('Failed to start self-hosted build worker services.', upResult);
  }

  if (!areCoreServicesAvailable) {
    throw createCommandError('Failed to start self-hosted build worker services.', upResult);
  }

  input.reportProgress?.(createCommandWarning(buildServicesUnavailableMessage, upResult));
}

async function pullSelfHostedBuildRuntimeImages(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
): Promise<void> {
  let pullResult: CommandResult | null;
  try {
    pullResult = await pullVerifiedRegistryRuntimeImages(context, input, selfHostedBuildRuntimeServiceNames, false);
  } catch (error) {
    const verificationError: Error = error instanceof Error ? error : new Error(String(error));
    input.reportProgress?.(createSelfHostedRuntimeImageSignatureWarning(verificationError));
    return;
  }

  if (pullResult !== null) {
    input.reportProgress?.(createCommandWarning(buildImagesUnavailableMessage, pullResult));
    return;
  }

  await verifyLocalBuildRuntimeImages(context, input);
}

async function didPullSelfHostedRuntimeImagesSucceed(
  context: DockerExecutionContext,
  imageRefs: SelfHostedImageRefs,
  pullResult: CommandResult,
): Promise<boolean> {
  if (pullResult.exitCode === 0) {
    return true;
  }
  if (usesMutableRegistryImageTag(imageRefs)) {
    return false;
  }

  const missingImageRefs: string[] = await readMissingSelfHostedRuntimeImageRefs(context, imageRefs);
  return missingImageRefs.length === 0;
}
