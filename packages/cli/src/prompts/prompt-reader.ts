import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import {
  createInterface as createQuestionInterface,
  type Interface as QuestionInterface,
} from 'node:readline/promises';
import { Writable } from 'node:stream';
import type { CliIo } from '../app.types';

interface QueuedPromptLineReader {
  ended: boolean;
  lines: string[];
  waiters: PromptLineWaiter[];
}

interface PromptLineWaiter {
  reject: (error: Error) => void;
  resolve: (value: string) => void;
}

interface InteractiveTtyInput extends NodeJS.ReadStream {
  isTTY: true;
}

type ResolvePromptCancel = (value: PromiseLike<never>) => void;
type RejectPromptCancel = (reason?: Error) => void;

const queuedPromptReaders: WeakMap<NodeJS.ReadableStream, QueuedPromptLineReader> = new WeakMap<
  NodeJS.ReadableStream,
  QueuedPromptLineReader
>();

export async function readPromptLine(io: CliIo, label: string): Promise<string> {
  if (isInteractivePromptInput(io.stdin)) {
    return await readInteractivePromptLine(io, label);
  }

  io.stderr(label);
  return await readQueuedPromptLine(io.stdin);
}

export async function readSecretPromptLine(io: CliIo, label: string): Promise<string> {
  if (isInteractivePromptInput(io.stdin)) {
    io.stderr(label);
    return await readInteractiveSecretPromptLine(io);
  }

  io.stderr(label);
  return await readQueuedPromptLine(io.stdin);
}

async function readInteractivePromptLine(io: CliIo, label: string): Promise<string> {
  const output: Writable = new PromptOutputStream(io);
  return await questionInteractiveInput(io.stdin, output, label);
}

async function readInteractiveSecretPromptLine(io: CliIo): Promise<string> {
  return await questionInteractiveInput(io.stdin, new MutedPromptOutputStream(), '');
}

async function questionInteractiveInput(
  input: NodeJS.ReadableStream,
  output: Writable,
  label: string,
): Promise<string> {
  const readline: QuestionInterface = createQuestionInterface({
    input,
    output,
    terminal: true,
  });

  try {
    return await waitForQuestionAnswer(readline, label);
  } finally {
    readline.close();
  }
}

async function waitForQuestionAnswer(readline: QuestionInterface, label: string): Promise<string> {
  const cancelRegistration: PromptCancelRegistration = new PromptCancelRegistration(readline);
  try {
    return await Promise.race([readline.question(label), cancelRegistration.promise]);
  } finally {
    cancelRegistration.cleanup();
  }
}

class PromptCancelRegistration {
  readonly promise: Promise<never>;
  readonly #cleanup: () => void;

  constructor(readline: QuestionInterface) {
    let cleanup: () => void = (): void => undefined;
    this.promise = new Promise<never>((_resolve: ResolvePromptCancel, reject: RejectPromptCancel): void => {
      const handleCancel: () => void = (): void => {
        reject(new Error('Prompt input cancelled.'));
      };
      cleanup = (): void => {
        readline.off('SIGINT', handleCancel);
      };
      readline.once('SIGINT', handleCancel);
    });
    this.#cleanup = cleanup;
  }

  cleanup(): void {
    this.#cleanup();
  }
}

async function readQueuedPromptLine(input: NodeJS.ReadableStream): Promise<string> {
  const reader: QueuedPromptLineReader = readQueuedPromptLineReader(input);
  const line: string | undefined = reader.lines.shift();
  if (line !== undefined) {
    return line;
  }
  if (reader.ended) {
    return '';
  }

  return await new Promise<string>((resolve: (value: string) => void, reject: (error: Error) => void): void => {
    reader.waiters.push({ reject, resolve });
  });
}

function readQueuedPromptLineReader(input: NodeJS.ReadableStream): QueuedPromptLineReader {
  const existingReader: QueuedPromptLineReader | undefined = queuedPromptReaders.get(input);
  if (existingReader !== undefined) {
    return existingReader;
  }

  const reader: QueuedPromptLineReader = createQueuedPromptLineReader(input);
  queuedPromptReaders.set(input, reader);
  return reader;
}

function createQueuedPromptLineReader(input: NodeJS.ReadableStream): QueuedPromptLineReader {
  const reader: QueuedPromptLineReader = {
    ended: false,
    lines: [],
    waiters: [],
  };
  const readline: ReadlineInterface = createInterface({
    crlfDelay: Infinity,
    input,
    terminal: false,
  });

  registerQueuedPromptLineHandlers(input, readline, reader);
  return reader;
}

function registerQueuedPromptLineHandlers(
  input: NodeJS.ReadableStream,
  readline: ReadlineInterface,
  reader: QueuedPromptLineReader,
): void {
  readline.on('line', (line: string): void => {
    const waiter: PromptLineWaiter | undefined = reader.waiters.shift();
    if (waiter === undefined) {
      reader.lines.push(line);
      return;
    }

    waiter.resolve(line);
  });
  readline.once('close', (): void => {
    reader.ended = true;
    resolveWaitingPromptLines(reader);
  });
  readline.once('error', (error: Error): void => {
    reader.ended = true;
    rejectWaitingPromptLines(reader, error);
    queuedPromptReaders.delete(input);
  });
}

function resolveWaitingPromptLines(reader: QueuedPromptLineReader): void {
  for (;;) {
    const waiter: PromptLineWaiter | undefined = reader.waiters.shift();
    if (waiter === undefined) {
      return;
    }

    waiter.resolve('');
  }
}

function rejectWaitingPromptLines(reader: QueuedPromptLineReader, error: Error): void {
  for (;;) {
    const waiter: PromptLineWaiter | undefined = reader.waiters.shift();
    if (waiter === undefined) {
      return;
    }

    waiter.reject(error);
  }
}

export function isInteractivePromptInput(input: NodeJS.ReadableStream): boolean {
  const ttyInput: Partial<InteractiveTtyInput> = input as Partial<InteractiveTtyInput>;
  return ttyInput.isTTY === true && typeof ttyInput.setRawMode === 'function';
}

class PromptOutputStream extends Writable {
  readonly #io: CliIo;

  constructor(io: CliIo) {
    super();
    this.#io = io;
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#io.stderr(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }
}

class MutedPromptOutputStream extends Writable {
  override _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }
}
