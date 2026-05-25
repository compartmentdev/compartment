import type { ReadableStreamReadResult } from 'node:stream/web';
import type { NormalizedOutboundHttpPolicy } from './outbound-http-client.types';
import { OutboundHttpPolicyError } from './outbound-http-error';

interface ResponseByteLimitReaderState {
  complete: () => void;
  completed: boolean;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  totalBytes: number;
}

export function createResponseByteLimitReadableStream(
  sourceStream: ReadableStream<Uint8Array>,
  policy: NormalizedOutboundHttpPolicy,
  url: URL,
  onBodyComplete: () => void,
): ReadableStream<Uint8Array> {
  const state: ResponseByteLimitReaderState = {
    complete: onBodyComplete,
    completed: false,
    reader: sourceStream.getReader(),
    totalBytes: 0,
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
      await pullResponseByteLimitChunk(state, policy, url, controller);
    },
    async cancel(reason?: Error): Promise<void> {
      await cancelResponseByteLimitRead(state, reason);
    },
  });
}

async function pullResponseByteLimitChunk(
  state: ResponseByteLimitReaderState,
  policy: NormalizedOutboundHttpPolicy,
  url: URL,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> {
  const chunk: Uint8Array | null = await readResponseByteLimitChunk(state, controller);
  if (chunk === null) {
    return;
  }

  state.totalBytes += chunk.byteLength;
  if (policy.maxResponseBytes !== null && state.totalBytes > policy.maxResponseBytes) {
    await rejectResponseByteLimitRead(state, controller, buildResponseByteLimitError(policy.maxResponseBytes, url));
    return;
  }

  controller.enqueue(chunk);
}

async function readResponseByteLimitChunk(
  state: ResponseByteLimitReaderState,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<Uint8Array | null> {
  const result: ReadableStreamReadResult<Uint8Array> | null = await readSourceStreamChunk(state, controller);
  if (result === null) {
    return null;
  }
  if (result.done === true) {
    completeResponseByteLimitRead(state);
    controller.close();
    return null;
  }

  return result.value;
}

async function readSourceStreamChunk(
  state: ResponseByteLimitReaderState,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  try {
    return await state.reader.read();
  } catch (error) {
    completeResponseByteLimitRead(state);
    controller.error(error);
    return null;
  }
}

async function rejectResponseByteLimitRead(
  state: ResponseByteLimitReaderState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  error: Error,
): Promise<void> {
  await state.reader.cancel(error);
  completeResponseByteLimitRead(state);
  controller.error(error);
}

async function cancelResponseByteLimitRead(state: ResponseByteLimitReaderState, reason?: Error): Promise<void> {
  try {
    await state.reader.cancel(reason);
  } finally {
    completeResponseByteLimitRead(state);
  }
}

function completeResponseByteLimitRead(state: ResponseByteLimitReaderState): void {
  if (state.completed) {
    return;
  }

  state.completed = true;
  state.complete();
}

function buildResponseByteLimitError(maxResponseBytes: number, url: URL): OutboundHttpPolicyError {
  return new OutboundHttpPolicyError(
    `Outbound HTTP response exceeded ${maxResponseBytes.toString()} bytes for ${url.toString()}.`,
  );
}
