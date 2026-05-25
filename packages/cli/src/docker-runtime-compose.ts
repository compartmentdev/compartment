import type { SystemServiceName } from '@compartment/contracts';
import { readCommandOutput } from './command-runner';
import type { CommandResult } from './command-runner.types';
import { runDockerCommand } from './docker-command';
import { buildComposeArguments } from './docker-runtime.inspect.helpers';
import type { DockerExecutionContext, StartSelfHostedRuntimeInput } from './docker-runtime.types';

export function buildComposeUpArguments(
  input: StartSelfHostedRuntimeInput,
  isRestart: boolean,
  services: readonly SystemServiceName[],
): string[] {
  const argumentsList: string[] = [...buildRuntimeComposeArguments(input), 'up', '-d', '--wait'];
  if (input.imageSource === 'registry') {
    argumentsList.push('--pull', 'never');
  }

  if (isRestart) {
    argumentsList.push('--remove-orphans', '--force-recreate');
  }

  argumentsList.push(...services);
  return argumentsList;
}

export async function stopSelfHostedRuntimeServices(
  context: DockerExecutionContext,
  input: StartSelfHostedRuntimeInput,
  services: readonly SystemServiceName[],
): Promise<CommandResult> {
  return await runDockerCommand(context, [...buildRuntimeComposeArguments(input), 'stop', ...services]);
}

function buildRuntimeComposeArguments(input: StartSelfHostedRuntimeInput): string[] {
  return buildComposeArguments(
    input.installDirectory,
    input.envPath,
    input.composePath,
    input.localComposePath,
    input.imageSource === 'local',
  );
}

export function createCommandWarning(prefix: string, result: CommandResult): string {
  const outputText: string = readCommandOutput(result);
  if (outputText === '') {
    return prefix;
  }

  return `${prefix}\n${outputText}`;
}

export function createCommandError(prefix: string, result: CommandResult): Error {
  const outputText: string = readCommandOutput(result);
  if (outputText === '') {
    return new Error(prefix);
  }

  return new Error(`${prefix}\n${outputText}`);
}
