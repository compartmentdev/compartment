import { readCommandOutput, runCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';

export async function runRequiredSelfHostedSystemCommand(
  command: readonly string[],
  failureMessage: string,
): Promise<void> {
  const result: CommandResult = await runCommand(command);
  if (result.exitCode === 0) {
    return;
  }

  const output: string = readCommandOutput(result);
  throw new Error(output === '' ? failureMessage : `${failureMessage}\n${output}`);
}
