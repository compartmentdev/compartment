import type { DockerBuildImageInput, DockerBuildImageResult } from './docker-models';
import { buildDockerImageWithRemoteBuildKit, prewarmSourceBuildToolchainWithRemoteBuildKit } from './docker-buildkit';

export async function buildDockerImage(input: DockerBuildImageInput): Promise<DockerBuildImageResult> {
  return await buildDockerImageWithRemoteBuildKit(input);
}

export async function prewarmSourceBuildToolchain(): Promise<void> {
  await prewarmSourceBuildToolchainWithRemoteBuildKit();
}
