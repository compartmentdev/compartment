import type { CommandResult } from './command-runner.types';
import { createCommandError, stopSelfHostedRuntimeServices } from './docker-runtime-compose';
import { selfHostedBuildRuntimeServiceNames } from './docker-runtime.service-names';
import type { DockerExecutionContext, StartSelfHostedRuntimeInput } from './docker-runtime.types';

export async function stopUnverifiedBuildRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
): Promise<void> {
  const stopResult: CommandResult = await stopSelfHostedRuntimeServices(
    context,
    input,
    selfHostedBuildRuntimeServiceNames,
  );
  if (stopResult.exitCode !== 0) {
    throw createCommandError('Failed to stop unsigned self-hosted build worker services.', stopResult);
  }
}
