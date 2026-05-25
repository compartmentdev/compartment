import { isAbsolute, join } from 'node:path';
import type { DockerBuildImageInput } from './docker-models';

export function readDockerfileBuildPath(input: DockerBuildImageInput): string {
  if (input.dockerfilePath === undefined || isAbsolute(input.dockerfilePath)) {
    return input.dockerfilePath ?? 'Dockerfile';
  }

  return join(input.contextDirectory, input.dockerfilePath);
}
