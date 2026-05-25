import { runProcessCommand } from './process-command';
import { withDockerRegistryAuthConfig } from './docker-registry-auth-config';
import { runCommandWithTransientRegistryRetry } from './registry-command-retry';
import type { DockerCommandResult } from './docker-command.types';
import type { DockerRegistryCredentials } from './docker-models';

export async function runDockerCommandWithRegistryRetry(
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
): Promise<DockerCommandResult> {
  return await runCommandWithTransientRegistryRetry(
    async (): Promise<DockerCommandResult> => await runDockerCommand(args, registryCredentials),
  );
}

export async function runDockerCommand(
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
): Promise<DockerCommandResult> {
  return await withDockerRegistryAuthConfig(
    registryCredentials,
    async (env: Record<string, string>): Promise<DockerCommandResult> =>
      await runProcessCommand({
        args,
        env,
        file: 'docker',
      }),
  );
}
