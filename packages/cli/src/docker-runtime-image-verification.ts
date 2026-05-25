import type { SystemServiceName } from '@compartment/contracts';
import type { CommandResult } from './command-runner.types';
import { runDockerCommand } from './docker-command';
import { areCoreRuntimeServicesAvailable } from './docker-runtime-availability';
import { stopUnverifiedBuildRuntimeServices } from './docker-runtime-build-service-recovery';
import { createCommandError } from './docker-runtime-compose';
import { readMissingDockerImageRefs, readThirdPartySelfHostedRuntimeImageRefs } from './docker-runtime-image-refs';
import {
  createSelfHostedRuntimeImageSignatureWarning,
  pullVerifiedRemoteSelfHostedRuntimeImages,
  verifyLocalSelfHostedRuntimeImageSignatures,
} from './docker-runtime-signature';
import { selfHostedBuildRuntimeServiceNames } from './docker-runtime.service-names';
import type {
  DockerExecutionContext,
  PrepareSelfHostedRuntimeImagesInput,
  StartSelfHostedRuntimeInput,
} from './docker-runtime.types';

interface RuntimeImagesBeforeStartVerification {
  context: DockerExecutionContext;
  includeRuntimeProbeImage: boolean;
  includePullDependencies: boolean;
  pullMissingRegistryImages: boolean;
  runtimeInput: StartSelfHostedRuntimeInput;
  services: readonly SystemServiceName[];
}

export async function verifyRequiredRuntimeImagesBeforeStart(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  services: readonly SystemServiceName[],
  pullMissingRegistryImages: boolean,
  includeRuntimeProbeImage: boolean = false,
): Promise<void> {
  await verifyRuntimeImagesBeforeStart(
    context,
    input,
    services,
    pullMissingRegistryImages,
    true,
    includeRuntimeProbeImage,
  );
}

export async function verifyBuildRuntimeImagesBeforeStart(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  pullMissingRegistryImages: boolean,
): Promise<boolean> {
  try {
    await verifyRuntimeImagesBeforeStart(
      context,
      input,
      selfHostedBuildRuntimeServiceNames,
      pullMissingRegistryImages,
      false,
    );
    return true;
  } catch (error) {
    const verificationError: Error = error instanceof Error ? error : new Error(String(error));
    if (!(await areCoreRuntimeServicesAvailable(context, input))) {
      throw verificationError;
    }

    await stopUnverifiedBuildRuntimeServices(context, input);
    input.reportProgress?.(createSelfHostedRuntimeImageSignatureWarning(verificationError));
    return false;
  }
}

export async function verifyLocalBuildRuntimeImages(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
): Promise<void> {
  const verificationError: Error | null = await readLocalRuntimeImageSignatureError(
    context,
    input,
    selfHostedBuildRuntimeServiceNames,
  );
  if (verificationError !== null) {
    input.reportProgress?.(createSelfHostedRuntimeImageSignatureWarning(verificationError));
  }
}

async function verifyRuntimeImagesBeforeStart(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  services: readonly SystemServiceName[],
  pullMissingRegistryImages: boolean,
  includePullDependencies: boolean,
  includeRuntimeProbeImage: boolean = false,
): Promise<void> {
  if (input.imageSource === 'local') {
    if (includeRuntimeProbeImage) {
      await verifyLocalRuntimeProbeImageAvailable(context, input);
    }
    return;
  }

  await verifyRegistryRuntimeImagesBeforeStart({
    context,
    includeRuntimeProbeImage,
    includePullDependencies,
    pullMissingRegistryImages,
    runtimeInput: input,
    services,
  });
}

export async function verifyLocalRuntimeProbeImageAvailable(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
): Promise<void> {
  const inspectResult: CommandResult = await runDockerCommand(context, [
    'image',
    'inspect',
    input.imageRefs.runtimeProbeImage,
  ]);
  if (inspectResult.exitCode !== 0) {
    throw createCommandError(
      `Expected local runtime probe image ${input.imageRefs.runtimeProbeImage} before runtime start.`,
      inspectResult,
    );
  }
}

async function verifyRegistryRuntimeImagesBeforeStart(input: RuntimeImagesBeforeStartVerification): Promise<void> {
  const verificationError: Error | null = await readLocalRuntimeImageSignatureError(
    input.context,
    input.runtimeInput,
    input.services,
    input.includeRuntimeProbeImage,
  );
  if (verificationError === null) {
    await pullMissingVerifiedRuntimeDependencies(input);
    return;
  }

  await recoverUnverifiedRuntimeImagesBeforeStart(input, verificationError);
}

async function pullMissingVerifiedRuntimeDependencies(input: RuntimeImagesBeforeStartVerification): Promise<void> {
  if (input.pullMissingRegistryImages) {
    await pullMissingThirdPartyRuntimeImagesBeforeStart(input.context, input.services, input.includePullDependencies);
  }
}

async function recoverUnverifiedRuntimeImagesBeforeStart(
  input: RuntimeImagesBeforeStartVerification,
  verificationError: Error,
): Promise<void> {
  if (!input.pullMissingRegistryImages) {
    throw verificationError;
  }

  await pullSignedRuntimeImagesBeforeStart(input);
}

async function pullSignedRuntimeImagesBeforeStart(input: RuntimeImagesBeforeStartVerification): Promise<void> {
  const pullResult: CommandResult | null = await pullVerifiedRegistryRuntimeImages(
    input.context,
    input.runtimeInput,
    input.services,
    input.includePullDependencies,
    input.includeRuntimeProbeImage,
  );
  if (pullResult !== null) {
    throw createCommandError('Failed to pull signed self-hosted images before runtime start.', pullResult);
  }
  await verifyLocalSelfHostedRuntimeImageSignatures({
    context: input.context,
    includeRuntimeProbeImage: input.includeRuntimeProbeImage,
    imageRefs: input.runtimeInput.imageRefs,
    services: input.services,
  });
}

async function pullMissingThirdPartyRuntimeImagesBeforeStart(
  context: DockerExecutionContext,
  services: readonly SystemServiceName[],
  includeDependencies: boolean,
): Promise<void> {
  const imageRefs: string[] = readThirdPartySelfHostedRuntimeImageRefs(services, includeDependencies);
  const missingImageRefs: string[] = await readMissingDockerImageRefs(context, imageRefs);

  for (const imageRef of missingImageRefs) {
    const pullResult: CommandResult = await runDockerCommand(context, ['pull', imageRef]);
    if (pullResult.exitCode !== 0) {
      throw createCommandError('Failed to pull self-hosted dependency images before runtime start.', pullResult);
    }
  }
}

export async function pullVerifiedRegistryRuntimeImages(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
  services: readonly SystemServiceName[],
  includePullDependencies: boolean,
  includeRuntimeProbeImage: boolean = false,
): Promise<CommandResult | null> {
  const signedPullResult: CommandResult | null = await pullVerifiedRemoteSelfHostedRuntimeImages({
    context,
    includeRuntimeProbeImage,
    imageRefs: input.imageRefs,
    services,
  });
  if (signedPullResult !== null) {
    return signedPullResult;
  }

  return await pullThirdPartySelfHostedRuntimeImages(context, services, includePullDependencies);
}

async function pullThirdPartySelfHostedRuntimeImages(
  context: DockerExecutionContext,
  services: readonly SystemServiceName[],
  includeDependencies: boolean,
): Promise<CommandResult | null> {
  for (const imageRef of readThirdPartySelfHostedRuntimeImageRefs(services, includeDependencies)) {
    const pullResult: CommandResult = await runDockerCommand(context, ['pull', imageRef]);
    if (pullResult.exitCode !== 0) {
      return pullResult;
    }
  }

  return null;
}

async function readLocalRuntimeImageSignatureError(
  context: DockerExecutionContext,
  input: PrepareSelfHostedRuntimeImagesInput,
  services: readonly SystemServiceName[],
  includeRuntimeProbeImage: boolean = false,
): Promise<Error | null> {
  try {
    await verifyLocalSelfHostedRuntimeImageSignatures({
      context,
      includeRuntimeProbeImage,
      imageRefs: input.imageRefs,
      services,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
