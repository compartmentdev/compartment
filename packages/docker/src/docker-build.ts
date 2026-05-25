import { runDockerCommand } from './docker-command';
import type { DockerCommandResult } from './docker-command.types';
import { readDockerCommandErrorText } from './docker-command-error';
import type {
  DockerBuildImageInput,
  DockerBuildImageResult,
  DockerInspectImageInput,
  DockerInspectImageResult,
} from './docker-models';
import { parseDockerInspectImageResult } from './docker-image-inspect';
import { buildDockerImageWithRemoteBuildKit, prewarmSourceBuildToolchainWithRemoteBuildKit } from './docker-buildkit';

export async function buildDockerImage(input: DockerBuildImageInput): Promise<DockerBuildImageResult> {
  return await buildDockerImageWithRemoteBuildKit(input);
}

export async function prewarmSourceBuildToolchain(): Promise<void> {
  await prewarmSourceBuildToolchainWithRemoteBuildKit();
}

export async function hasDockerImage(input: DockerInspectImageInput): Promise<boolean> {
  return (await readDockerImageInspectOutput(input.imageRef)) !== null;
}

export async function inspectDockerImage(input: DockerInspectImageInput): Promise<DockerInspectImageResult> {
  const output: DockerCommandResult | null = await readDockerImageInspectOutput(input.imageRef);
  if (output === null) {
    throw new Error(`Expected docker image "${input.imageRef}" to exist.`);
  }

  return parseDockerInspectImageResult(output.stdout, input.imageRef);
}

async function readDockerImageInspectOutput(imageRef: string): Promise<DockerCommandResult | null> {
  try {
    return await runDockerCommand(['image', 'inspect', '--format', '{{json .Config}}', imageRef]);
  } catch (error) {
    if (isDockerImageMissingError(error instanceof Error ? error : null)) {
      return null;
    }

    throw error;
  }
}

function isDockerImageMissingError(error: Error | null): boolean {
  const errorText: string | null = readDockerCommandErrorText(error);
  if (errorText === null) {
    return false;
  }

  return errorText.includes('no such image');
}
