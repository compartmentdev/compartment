import type Docker from 'dockerode';
import { createDockerClient } from './docker-client';
import type { DockerRenameContainerInput, DockerStartContainerInput, DockerStopContainerInput } from './docker-models';
import { isDockerContainerMissingError } from './docker-engine-runtime';

export async function renameDockerEngineContainer(input: DockerRenameContainerInput): Promise<void> {
  const docker: Docker = await createDockerClient();

  try {
    await docker.getContainer(input.containerRef).rename({ name: input.nextContainerName });
  } catch (error) {
    if (typeof error === 'object' && error !== null && isDockerContainerMissingError(error)) {
      return;
    }

    throw error;
  }
}

export async function startDockerEngineContainer(input: DockerStartContainerInput): Promise<void> {
  const docker: Docker = await createDockerClient();
  await docker.getContainer(input.containerRef).start();
}

export async function stopDockerEngineContainer(input: DockerStopContainerInput): Promise<void> {
  const docker: Docker = await createDockerClient();
  await docker.getContainer(input.containerRef).stop();
}
