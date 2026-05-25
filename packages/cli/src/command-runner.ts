import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileException,
  type ExecFileOptionsWithStringEncoding,
  type SpawnOptions,
} from 'node:child_process';
import { promisify } from 'node:util';
import { hasText, isMissingFileSystemEntryError } from '@compartment/utils';
import type { CommandResult } from './command-runner.types';

const cappedCommandOutputCharacterLimit: number = 16_000;
const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptionsWithStringEncoding,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

export async function canRunCommand(command: readonly string[], env?: NodeJS.ProcessEnv): Promise<boolean> {
  const result: CommandResult = await runCommand(command, env);
  return result.exitCode === 0;
}

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

export async function runCappedCommand(command: readonly string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }

  return await waitForCappedCommandResult(file, args, env);
}

export async function runInheritedCommand(command: readonly string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }

  return await waitForInheritedCommandResult(file, args, env);
}

export async function runInheritedCommandWithPipedOutput(
  command: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const [file, ...args] = command;
  if (file === undefined) {
    throw new Error('Expected a command to execute.');
  }

  return await waitForInheritedCommandWithPipedOutputResult(file, args, env);
}

export function readCommandOutput(result: CommandResult): string {
  const lines: string[] = [result.stderr.trim(), result.stdout.trim()].filter(hasText);
  return lines.join('\n');
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

async function waitForCappedCommandResult(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve: (result: CommandResult) => void): void => {
    const child: ChildProcess = spawn(file, args, readPipedSpawnOptions(env));
    let stderr: string = '';
    let stdout: string = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string | Buffer): void => {
      stdout = appendCappedCommandOutput(stdout, readCommandChunk(chunk));
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string | Buffer): void => {
      stderr = appendCappedCommandOutput(stderr, readCommandChunk(chunk));
    });
    child.on('error', (error: Error): void => {
      resolve(createSpawnErrorCommandResult(error));
    });
    child.on('close', (code: number | null): void => {
      resolve(createPipedCommandResult(code, stdout, stderr));
    });
  });
}

async function waitForInheritedCommandResult(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve: (result: CommandResult) => void): void => {
    const child: ChildProcess = spawn(file, args, readInheritedSpawnOptions(env));
    child.on('error', (error: Error): void => {
      resolve(createSpawnErrorCommandResult(error));
    });
    child.on('close', (code: number | null): void => {
      resolve(createSpawnExitCommandResult(code));
    });
  });
}

async function waitForInheritedCommandWithPipedOutputResult(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve: (result: CommandResult) => void): void => {
    const child: ChildProcess = spawn(file, args, readInheritedStderrSpawnOptions(env));
    let stdout: string = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string | Buffer): void => {
      stdout = appendCappedCommandOutput(stdout, readCommandChunk(chunk));
    });
    child.on('error', (error: Error): void => {
      resolve(createSpawnErrorCommandResult(error));
    });
    child.on('close', (code: number | null): void => {
      resolve(createPipedCommandResult(code, stdout, ''));
    });
  });
}

function createSpawnErrorCommandResult(error: Error): CommandResult {
  return {
    exitCode: 127,
    stderr: error.message,
    stdout: '',
  };
}

function createPipedCommandResult(code: number | null, stdout: string, stderr: string): CommandResult {
  return {
    exitCode: code ?? 1,
    stderr: stderr.trim(),
    stdout: stdout.trim(),
  };
}

function createSpawnExitCommandResult(code: number | null): CommandResult {
  return {
    exitCode: code ?? 1,
    stderr: '',
    stdout: '',
  };
}

function appendCappedCommandOutput(output: string, chunk: string): string {
  const nextOutput: string = output + chunk;
  return nextOutput.length <= cappedCommandOutputCharacterLimit
    ? nextOutput
    : nextOutput.slice(-cappedCommandOutputCharacterLimit);
}

function readCommandChunk(chunk: string | Buffer): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
}

function readInheritedSpawnOptions(env: NodeJS.ProcessEnv | undefined): SpawnOptions {
  return {
    ...(env === undefined ? {} : { env }),
    stdio: 'inherit',
  };
}

function readInheritedStderrSpawnOptions(env: NodeJS.ProcessEnv | undefined): SpawnOptions {
  return {
    ...(env === undefined ? {} : { env }),
    stdio: ['inherit', 'pipe', 'inherit'],
  };
}

function readPipedSpawnOptions(env: NodeJS.ProcessEnv | undefined): SpawnOptions {
  return {
    ...(env === undefined ? {} : { env }),
    stdio: ['inherit', 'pipe', 'pipe'],
  };
}
