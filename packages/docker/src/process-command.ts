import { createInterface, type Interface } from 'node:readline';
import type { Readable } from 'node:stream';
import { execa, type ResultPromise } from 'execa';
import type {
  ProcessCommandInput,
  ProcessCommandProgressHandlers,
  ProcessCommandResult,
} from './process-command.types';
import type { DockerLogStream } from './docker-models';

const maxTrackedProcessCommandOutputLength: number = 64 * 1024;
interface ProgressProcessCommandOptions {
  buffer: false;
  env: NodeJS.ProcessEnv;
  reject: false;
  stdin: 'ignore';
  stripFinalNewline: false;
}

export async function runProcessCommand(input: ProcessCommandInput): Promise<ProcessCommandResult> {
  return await execa(input.file, input.args, {
    env: buildProcessCommandEnv(input),
    stripFinalNewline: false,
  });
}

export async function runProcessCommandWithProgress(
  input: ProcessCommandInput,
  progressHandlers: ProcessCommandProgressHandlers,
): Promise<ProcessCommandResult> {
  const output: ProcessCommandResult = { stderr: '', stdout: '' };
  const progressAbortController: AbortController = new AbortController();
  const options: ProgressProcessCommandOptions = buildProgressProcessCommandOptions(input);
  const subprocess: ResultPromise<ProgressProcessCommandOptions> = execa(input.file, input.args, options);
  collectProcessCommandOutput(subprocess.stdout, 'stdout', output);
  collectProcessCommandOutput(subprocess.stderr, 'stderr', output);
  const [result] = await Promise.all([
    subprocess,
    pipeProcessCommandLines(subprocess.stdout, 'stdout', progressHandlers, progressAbortController),
    pipeProcessCommandLines(subprocess.stderr, 'stderr', progressHandlers, progressAbortController),
  ]);
  if (result instanceof Error) {
    Object.assign(result, output);
    throw result;
  }
  return output;
}

function buildProgressProcessCommandOptions(input: ProcessCommandInput): ProgressProcessCommandOptions {
  return {
    buffer: false,
    env: buildProcessCommandEnv(input),
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
  };
}

function collectProcessCommandOutput(
  stream: Readable,
  outputStream: DockerLogStream,
  output: ProcessCommandResult,
): void {
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string): void => {
    output[outputStream] = `${output[outputStream]}${chunk}`.slice(-maxTrackedProcessCommandOutputLength);
  });
}

async function pipeProcessCommandLines(
  stream: NodeJS.ReadableStream,
  outputStream: DockerLogStream,
  progressHandlers: ProcessCommandProgressHandlers,
  abortController: AbortController,
): Promise<void> {
  const reader: Interface = createInterface({
    input: stream,
  });

  try {
    for await (const line of reader) {
      if (abortController.signal.aborted) {
        return;
      }
      await progressHandlers.onLine(outputStream, line);
    }
  } catch (error) {
    abortController.abort();
    throw error instanceof Error ? error : new Error('Process command failed while streaming progress.');
  } finally {
    reader.close();
  }
}

function buildProcessCommandEnv(input: ProcessCommandInput): NodeJS.ProcessEnv {
  return { ...process.env, ...(input.env ?? {}) };
}
