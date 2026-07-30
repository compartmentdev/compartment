import type { DockerBuildImageInput, DockerBuildImageResult } from './docker-models';
import { buildDockerImageWithRemoteBuildKit } from './docker-buildkit';

export async function buildDockerImage(input: DockerBuildImageInput): Promise<DockerBuildImageResult> {
  return await buildDockerImageWithRemoteBuildKit(input);
}
