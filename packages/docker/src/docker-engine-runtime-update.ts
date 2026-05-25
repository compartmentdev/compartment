import type Docker from 'dockerode';
import { createDockerClient } from './docker-client';
import { buildDockerRestartPolicy } from './docker-engine-runtime-restart-policy';
import type { DockerUpdateContainerRestartPolicyInput } from './docker-models';

export async function updateDockerEngineContainerRestartPolicy(
  input: DockerUpdateContainerRestartPolicyInput,
): Promise<void> {
  const docker: Docker = await createDockerClient();
  await docker.getContainer(input.containerRef).update({
    RestartPolicy: buildDockerRestartPolicy(input.restartPolicy),
  });
}
