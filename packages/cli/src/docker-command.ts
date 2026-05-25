import { runCappedCommand, runCommand, runInheritedCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';
import { readNonCompartmentEnvironment } from './command-environment';
import type { DockerExecutionContext } from './docker-runtime.types';

export async function runDockerCommand(
  context: DockerExecutionContext,
  args: readonly string[],
): Promise<CommandResult> {
  return await runDockerCommandWithExecutor(context, args, runCommand, runInheritedCommand);
}

export async function runQuietDockerCommand(
  context: DockerExecutionContext,
  args: readonly string[],
): Promise<CommandResult> {
  return await runDockerCommandWithExecutor(context, args, runCappedCommand, runCappedCommand);
}

async function runDockerCommandWithExecutor(
  context: DockerExecutionContext,
  args: readonly string[],
  quietExecutor: (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>,
  inheritedExecutor: (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>,
): Promise<CommandResult> {
  const command: string[] = [...context.dockerCommand, ...args];
  const env: NodeJS.ProcessEnv = readNonCompartmentEnvironment(process.env);
  if (context.mode === 'sudo') {
    return await inheritedExecutor(command, env);
  }

  return await quietExecutor(command, env);
}
