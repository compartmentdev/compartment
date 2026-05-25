import { runProcessCommand, runProcessCommandWithProgress } from './process-command';
import { withDockerRegistryAuthConfig } from './docker-registry-auth-config';
import { runCommandWithTransientRegistryRetry } from './registry-command-retry';
import type { DockerCommandResult } from './docker-command.types';
import type { DockerLogStream, DockerProgressReporter, DockerRegistryCredentials } from './docker-models';

const buildKitAddressEnvName: string = 'BUILDKIT_ADDR';

export function readBuildKitAddress(): string | null {
  const rawValue: string | undefined = process.env[buildKitAddressEnvName];

  return typeof rawValue === 'string' && rawValue.trim() !== '' ? rawValue : null;
}

export async function runBuildctlCommandWithOptionalProgressReporter(
  args: string[],
  onProgressLine: DockerProgressReporter | undefined,
  registryCredentials?: DockerRegistryCredentials,
): Promise<void> {
  if (onProgressLine === undefined) {
    await runBuildctlCommandWithRegistryRetry(args, registryCredentials);
    return;
  }

  await withDockerRegistryAuthConfig(registryCredentials, async (env: Record<string, string>): Promise<void> => {
    await runCommandWithTransientRegistryRetry(
      async (): Promise<DockerCommandResult> =>
        await runProcessCommandWithProgress(
          { args, env, file: 'buildctl' },
          buildDockerProgressReporter(onProgressLine),
        ),
    );
  });
}

export async function runBuildctlCommandWithRegistryRetry(
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
): Promise<DockerCommandResult> {
  return await withDockerRegistryAuthConfig(
    registryCredentials,
    async (env: Record<string, string>): Promise<DockerCommandResult> =>
      await runCommandWithTransientRegistryRetry(
        async (): Promise<DockerCommandResult> =>
          await runProcessCommand({
            args,
            env,
            file: 'buildctl',
          }),
      ),
  );
}

function buildDockerProgressReporter(onProgressLine: DockerProgressReporter): {
  onLine: (stream: DockerLogStream, message: string) => Promise<void>;
} {
  return {
    onLine: async (stream: DockerLogStream, message: string): Promise<void> => {
      await onProgressLine({ message, stream });
    },
  };
}
