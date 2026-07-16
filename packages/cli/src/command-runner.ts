import { execFile, type ExecFileException, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { promisify } from 'node:util';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import type { CommandResult } from './command-runner.types';

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptionsWithStringEncoding,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

export async function runCommand(command: readonly string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }

  try {
    const result: { stderr: string; stdout: string } = await executeFileAsync(
      file,
      args,
      env === undefined ? {} : { env },
    );
    return {
      exitCode: 0,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } catch (error) {
    return readFailedCommandResult(error as ExecFileException);
  }
}

function readFailedCommandResult(error: ExecFileException): CommandResult {
  return {
    exitCode: readFailedExitCode(error),
    stderr: error.stderr ?? error.message,
    stdout: error.stdout ?? '',
  };
}

function readFailedExitCode(error: ExecFileException): number {
  if (typeof error.code === 'number') {
    return error.code;
  }
  if (isMissingFileSystemEntryError(error)) {
    return 127;
  }

  return 1;
}
