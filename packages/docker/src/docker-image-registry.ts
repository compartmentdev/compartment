import { runDockerCommandWithRegistryRetry } from './docker-command';
import { hasDockerImage } from './docker-build';
import type { DockerInspectImageInput } from './docker-models';

export async function ensureDockerImageAvailable(input: DockerInspectImageInput): Promise<void> {
  if (await hasDockerImage(input)) {
    return;
  }

  await runDockerCommandWithRegistryRetry(['pull', input.imageRef], input.registryCredentials);
}

export async function requireDockerImageAvailable(input: DockerInspectImageInput): Promise<void> {
  if (await hasDockerImage(input)) {
    return;
  }

  throw new Error(`Expected docker image "${input.imageRef}" to exist locally.`);
}
