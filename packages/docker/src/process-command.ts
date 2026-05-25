import { execFile, spawn, type ChildProcessByStdio, type ExecFileOptions } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import type {
  ProcessCommandError,
  ProcessCommandInput,
  ProcessCommandOutputBuffers,
  ProcessCommandProgressHandlers,
  ProcessCommandResult,
} from './process-command.types';
import type { DockerLogStream } from './docker-models';

type ExecuteFileAsync = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<ProcessCommandResult>;
type ResolveProcessCommandResult = (value: ProcessCommandResult | PromiseLike<ProcessCommandResult>) => void;
type RejectProcessCommand = (error: Error) => void;
type IsProcessCommandRejected = () => boolean;
type ProcessCommandChild = ChildProcessByStdio<null, Readable, Readable>;

const executeFileAsync: ExecuteFileAsync = promisify(execFile);
const maxTrackedProcessCommandOutputLength: number = 64 * 1024;

export async function runProcessCommand(input: ProcessCommandInput): Promise<ProcessCommandResult> {
  return await executeFileAsync(input.file, input.args, buildProcessCommandOptions(input));
}

export async function runProcessCommandWithProgress(
  input: ProcessCommandInput,
  progressHandlers: ProcessCommandProgressHandlers,
): Promise<ProcessCommandResult> {
  return await new Promise<ProcessCommandResult>(
    (resolve: ResolveProcessCommandResult, reject: RejectProcessCommand): void => {
      const child: ProcessCommandChild = createProcessCommandChild(input);
      const outputBuffers: ProcessCommandOutputBuffers = { stderr: '', stdout: '' };
      let rejected: boolean = false;
      const rejectOnce: RejectProcessCommand = (error: Error): void => {
        if (rejected) {
          return;
        }

        rejected = true;
        reject(error);
      };
      const isRejected: IsProcessCommandRejected = (): boolean => rejected;

      child.once('error', rejectOnce);
      collectProcessCommandOutput(child, outputBuffers);
      trackProcessCommandProgress(child, progressHandlers, rejectOnce, isRejected);
      settleProcessCommand(child, input, outputBuffers, resolve, rejectOnce, isRejected);
    },
  );
}

function createProcessCommandChild(input: ProcessCommandInput): ProcessCommandChild {
  return spawn(input.file, input.args, {
    ...buildProcessCommandOptions(input),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function buildProcessCommandOptions(input: ProcessCommandInput): ExecFileOptions {
  return {
    env: {
      ...process.env,
      ...(input.env ?? {}),
    },
  };
}

function collectProcessCommandOutput(child: ProcessCommandChild, outputBuffers: ProcessCommandOutputBuffers): void {
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string): void => {
    outputBuffers.stdout = appendTrackedProcessCommandOutput(outputBuffers.stdout, chunk);
  });
  child.stderr.on('data', (chunk: string): void => {
    outputBuffers.stderr = appendTrackedProcessCommandOutput(outputBuffers.stderr, chunk);
  });
}

function appendTrackedProcessCommandOutput(buffer: string, chunk: string): string {
  const nextBuffer: string = `${buffer}${chunk}`;
  return nextBuffer.length <= maxTrackedProcessCommandOutputLength
    ? nextBuffer
    : nextBuffer.slice(-maxTrackedProcessCommandOutputLength);
}

function trackProcessCommandProgress(
  child: ProcessCommandChild,
  progressHandlers: ProcessCommandProgressHandlers,
  reject: RejectProcessCommand,
  isRejected: IsProcessCommandRejected,
): void {
  void pipeProcessCommandLines(child.stdout, 'stdout', progressHandlers, reject, isRejected);
  void pipeProcessCommandLines(child.stderr, 'stderr', progressHandlers, reject, isRejected);
}

function settleProcessCommand(
  child: ProcessCommandChild,
  input: ProcessCommandInput,
  outputBuffers: ProcessCommandOutputBuffers,
  resolve: ResolveProcessCommandResult,
  reject: RejectProcessCommand,
  isRejected: IsProcessCommandRejected,
): void {
  child.once('close', (code: number | null): void => {
    if (isRejected()) {
      return;
    }

    if (code === 0) {
      resolve(outputBuffers);
      return;
    }

    reject(buildProcessCommandFailure(input, code, outputBuffers.stdout, outputBuffers.stderr));
  });
}

async function pipeProcessCommandLines(
  stream: NodeJS.ReadableStream,
  outputStream: DockerLogStream,
  progressHandlers: ProcessCommandProgressHandlers,
  reject: RejectProcessCommand,
  isRejected: IsProcessCommandRejected,
): Promise<void> {
  const reader: Interface = createInterface({
    input: stream,
  });

  try {
    for await (const line of reader) {
      if (isRejected()) {
        return;
      }

      await progressHandlers.onLine(outputStream, line);
    }
  } catch (error) {
    const processError: Error =
      error instanceof Error ? error : new Error('Process command failed while streaming progress.');
    reject(processError);
  } finally {
    reader.close();
  }
}

function buildProcessCommandFailure(
  input: ProcessCommandInput,
  code: number | null,
  stdout: string,
  stderr: string,
): Error {
  const error: ProcessCommandError = new Error(
    `${input.file} ${input.args.join(' ')} failed${code === null ? '' : ` with exit code ${code}`}.`,
  );
  error.code = code ?? undefined;
  error.stderr = stderr;
  error.stdout = stdout;
  return error;
}
