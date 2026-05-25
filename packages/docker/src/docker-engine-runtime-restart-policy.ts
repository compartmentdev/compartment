import type Docker from 'dockerode';
import type { DockerRestartPolicy } from './docker-models';

export function buildDockerRestartPolicy(restartPolicy: DockerRestartPolicy): Docker.HostRestartPolicy {
  return {
    ...(restartPolicy.maximumRetryCount !== undefined ? { MaximumRetryCount: restartPolicy.maximumRetryCount } : {}),
    Name: restartPolicy.name,
  };
}
