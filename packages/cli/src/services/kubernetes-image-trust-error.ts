import type { CommandResult } from '../command-runner.types';
import { formatKubernetesCommandExecutionFailure, readCommandOutput } from './kubernetes-command.support';

export function createImageTrustCommandError(prefix: string, result: CommandResult): Error {
  const executionFailure: string | undefined = formatKubernetesCommandExecutionFailure(prefix, result);
  if (executionFailure !== undefined) {
    return new Error(executionFailure);
  }
  const output: string = readCommandOutput(result);
  if (result.exitCode === 124) {
    return new Error(
      `${prefix} The registry or signature service did not respond before the command timeout. Check registry connectivity and re-run install to resume.${output === '' ? '' : `\n${output}`}`,
    );
  }
  return new Error(
    output === ''
      ? `${prefix} Command exited with status ${result.exitCode.toString()} and produced no diagnostics.`
      : `${prefix}\n${output}`,
  );
}
