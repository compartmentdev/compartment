import {
  execFile,
  type ChildProcess,
  type ExecFileException,
  type ExecFileOptionsWithStringEncoding,
} from 'node:child_process';
import { promisify } from 'node:util';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import type { CommandResult } from './command-runner.types';

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptionsWithStringEncoding,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

export async function runCommand(command: readonly string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return await executeCommand(command, env);
}

export async function runCommandWithTimeout(
  command: readonly string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return await executeCommand(command, env, timeoutMs);
}

async function executeCommand(
  command: readonly string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs?: number,
): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }
  const options: ExecFileOptionsWithStringEncoding = {
    ...(env === undefined ? {} : { env }),
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  };
  return await executeResolvedCommand(file, args, options, timeoutMs);
}

async function executeResolvedCommand(
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
  timeoutMs?: number,
): Promise<CommandResult> {
  try {
    const result: { stderr: string; stdout: string } = await executeFileAsync(file, args, options);
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure: ExecFileException = error as ExecFileException;
    return timeoutMs !== undefined && failure.killed === true
      ? readTimedOutCommandResult(failure, timeoutMs)
      : readFailedCommandResult(failure);
  }
}

export async function runCommandWithInput(command: readonly string[], input: string): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }

  return await new Promise<CommandResult>((resolveResult: (result: CommandResult) => void): void => {
    const child: ChildProcess = execFile(
      file,
      args,
      { encoding: 'utf8' },
      (error: ExecFileException | null, stdout: string, stderr: string): void => {
        if (error === null) {
          resolveResult({ exitCode: 0, stderr, stdout });
          return;
        }
        resolveResult(readFailedCommandResult(Object.assign(error, { stderr, stdout })));
      },
    );
    child.stdin?.end(input);
  });
}

function readFailedCommandResult(error: ExecFileException): CommandResult {
  return {
    exitCode: readFailedExitCode(error),
    stderr: error.stderr ?? error.message,
    stdout: error.stdout ?? '',
  };
}

function readTimedOutCommandResult(error: ExecFileException, timeoutMs: number): CommandResult {
  return {
    exitCode: 124,
    stderr: `Command timed out after ${Math.ceil(timeoutMs / 1000).toString()} seconds.${error.stderr === undefined || error.stderr === '' ? '' : `\n${error.stderr}`}`,
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
