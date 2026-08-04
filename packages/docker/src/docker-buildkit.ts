import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuildKitAddress, runBuildctlCommandWithOptionalProgressReporter } from './buildkit-command';
import { buildDockerfileBuildctlArgs, buildRailpackImageBuildctlArgs } from './docker-buildkit-args';
import { readPushedBuildKitImageRef } from './docker-buildkit-metadata';
import { buildRailpackPlanPaths } from './docker-build-plan';
import type { RailpackBuildSecrets, RailpackPlanPaths } from './docker-build.types';
import {
  buildPrepareRailpackPlanInput,
  prepareRailpackBuildSecrets,
  requireStaticOutputDirectory,
} from './docker-railpack-build';
import type { DockerBuildImageInput, DockerBuildImageResult } from './docker-models';
import { normalizeStaticRailpackPlan } from './docker-static-plan';
import { prepareRailpackPlan } from './railpack-command';
import { pinRailpackPlanImages } from './docker-railpack-image-pins';

const buildKitMetadataFileName: string = 'buildkit-metadata.json';

export async function buildDockerImageWithRemoteBuildKit(
  input: DockerBuildImageInput,
): Promise<DockerBuildImageResult> {
  const buildKitAddress: string = requireBuildKitAddress();
  const metadataDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-buildkit-metadata-'));
  const metadataFile: string = join(metadataDirectory, buildKitMetadataFileName);

  try {
    if (input.packer === 'dockerfile') {
      await runBuildKitDockerfileBuild(input, buildKitAddress, metadataFile);
    } else {
      await runBuildKitRailpackBuild(input, buildKitAddress, metadataFile);
    }

    return {
      imageRef: await readPushedBuildKitImageRef(metadataFile, input.imageTag),
      pushed: true,
    };
  } finally {
    await rm(metadataDirectory, { force: true, recursive: true });
  }
}

async function runBuildKitDockerfileBuild(
  input: DockerBuildImageInput,
  buildKitAddress: string,
  metadataFile: string,
): Promise<void> {
  await runBuildctlCommandWithOptionalProgressReporter(
    buildDockerfileBuildctlArgs({
      buildKitAddress,
      input,
      metadataFile,
    }),
    input.onProgressLine,
    input.pushRegistryCredentials,
  );
}

async function runBuildKitRailpackBuild(
  input: DockerBuildImageInput,
  buildKitAddress: string,
  metadataFile: string,
): Promise<void> {
  const railpackDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-railpack-'));
  const railpackPlanPaths: RailpackPlanPaths = buildRailpackPlanPaths(railpackDirectory);
  const railpackSecrets: RailpackBuildSecrets = await prepareRailpackBuildSecrets(railpackDirectory, input);

  try {
    await prepareRailpackBuildPlan(input, railpackPlanPaths);
    await runBuildctlCommandWithOptionalProgressReporter(
      buildRailpackImageBuildctlArgs({
        buildKitAddress,
        input,
        metadataFile,
        railpackDirectory,
        railpackSecrets,
      }),
      input.onProgressLine,
      input.pushRegistryCredentials,
    );
  } finally {
    await rm(railpackDirectory, { force: true, recursive: true });
  }
}

async function prepareRailpackBuildPlan(
  input: DockerBuildImageInput,
  railpackPlanPaths: RailpackPlanPaths,
): Promise<void> {
  await prepareRailpackPlan(buildPrepareRailpackPlanInput(input, railpackPlanPaths));
  await pinRailpackPlanImages(railpackPlanPaths.planPath);
  if (input.packer === 'static') {
    await normalizeStaticRailpackPlan(railpackPlanPaths.planPath, requireStaticOutputDirectory(input));
  }
}

function requireBuildKitAddress(): string {
  const buildKitAddress: string | null = readBuildKitAddress();
  if (buildKitAddress !== null) {
    return buildKitAddress;
  }

  throw new Error('BUILDKIT_ADDR is required for remote BuildKit source builds.');
}
