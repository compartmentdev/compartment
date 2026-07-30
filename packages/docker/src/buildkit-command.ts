import { runProcessCommand, runProcessCommandWithProgress } from './process-command';
import { readBuildKitAddressFromArgs, waitForBuildKitEndpoint } from './buildkit-endpoint';
import { withDockerRegistryAuthConfig } from './docker-registry-auth-config';
import { runCommandWithTransientBuildRetry } from './build-command-retry';
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

  await waitForRequiredBuildKitEndpoint(args);
  const buildKitAddress: string = readRequiredBuildKitAddress(args);
  await withDockerRegistryAuthConfig(registryCredentials, async (env: Record<string, string>): Promise<void> => {
    await runCommandWithTransientBuildRetry(
      async (): Promise<DockerCommandResult> =>
        await runProcessCommandWithProgress(
          { args, env, file: 'buildctl' },
          buildDockerProgressReporter(onProgressLine),
        ),
      buildKitAddress,
    );
  });
}

async function runBuildctlCommandWithRegistryRetry(
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
): Promise<DockerCommandResult> {
  await waitForRequiredBuildKitEndpoint(args);
  const buildKitAddress: string = readRequiredBuildKitAddress(args);
  return await withDockerRegistryAuthConfig(
    registryCredentials,
    async (env: Record<string, string>): Promise<DockerCommandResult> =>
      await runCommandWithTransientBuildRetry(
        async (): Promise<DockerCommandResult> =>
          await runProcessCommand({
            args,
            env,
            file: 'buildctl',
          }),
        buildKitAddress,
      ),
  );
}

async function waitForRequiredBuildKitEndpoint(args: readonly string[]): Promise<void> {
  await waitForBuildKitEndpoint(readRequiredBuildKitAddress(args));
}

function readRequiredBuildKitAddress(args: readonly string[]): string {
  const buildKitAddress: string | null = readBuildKitAddressFromArgs(args);
  if (buildKitAddress === null) {
    throw new Error('Expected buildctl arguments to include --addr <tcp endpoint>.');
  }
  return buildKitAddress;
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
