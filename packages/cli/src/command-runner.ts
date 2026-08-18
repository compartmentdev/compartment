import type { Result } from 'execa';
import { basename } from 'node:path';
import type { CommandResult } from './command-runner.types';

interface CommandExecutionOptions {
  env?: NodeJS.ProcessEnv;
  extendEnv: false;
  input?: string;
  reject: false;
  stripFinalNewline: false;
  timeout?: number;
}

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

export async function runCommandWithInput(command: readonly string[], input: string): Promise<CommandResult> {
  return await executeCommand(command, undefined, undefined, input);
}

export async function runCommandWithInputAndTimeout(
  command: readonly string[],
  input: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return await executeCommand(command, undefined, timeoutMs, input);
}

async function executeCommand(
  command: readonly string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs?: number,
  input?: string,
): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }
  const options: CommandExecutionOptions = {
    extendEnv: false,
    reject: false,
    stripFinalNewline: false,
    ...(env === undefined ? {} : { env }),
    ...(input === undefined ? {} : { input }),
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  };
  const { execa } = await import(/* webpackMode: "eager" */ 'execa');
  const result: Result<CommandExecutionOptions> = await execa(file, args, options);
  return readCommandResult(result, file, timeoutMs);
}

function readCommandResult(
  result: Result<CommandExecutionOptions>,
  command: string,
  timeoutMs?: number,
): CommandResult {
  if (result.timedOut && timeoutMs !== undefined) {
    return {
      exitCode: 124,
      stderr: `Command timed out after ${Math.ceil(timeoutMs / 1000).toString()} seconds.${result.stderr === '' ? '' : `\n${result.stderr}`}`,
      stdout: result.stdout,
    };
  }

  return {
    exitCode: result.exitCode ?? (result.code === 'ENOENT' ? 127 : 1),
    ...(result.code === 'ENOENT'
      ? { failure: { command: basename(command), kind: 'command-not-found' as const } }
      : {}),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}
