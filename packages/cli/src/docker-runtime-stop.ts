import type { CommandResult } from './command-runner.types';
import { createCommandError, stopSelfHostedRuntimeServices } from './docker-runtime-compose';
import { selfHostedComposeServiceNames } from './docker-runtime.service-names';
import type { DockerExecutionContext, RestartSelfHostedRuntimeInput } from './docker-runtime.types';

export async function stopSelfHostedRuntime(
  context: DockerExecutionContext,
  input: RestartSelfHostedRuntimeInput,
): Promise<void> {
  const result: CommandResult = await stopSelfHostedRuntimeServices(context, input, selfHostedComposeServiceNames);
  if (result.exitCode !== 0) {
    throw createCommandError('Failed to stop self-hosted runtime.', result);
  }
}
