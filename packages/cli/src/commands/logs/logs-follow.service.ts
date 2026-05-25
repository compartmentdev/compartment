import { setTimeout as sleep } from 'node:timers/promises';
import type { CliIo } from '../../app.types';
import type { FollowAbortRegistration, LogsFollowCursor } from './logs.command.types';

const defaultFollowPollIntervalMs: number = 1_000;

interface FollowLogsWithPollingInput<Response, Line> {
  createSignature: (line: Line) => string;
  io: CliIo;
  pollIntervalMs?: number | undefined;
  readInitial: () => Promise<Response>;
  readLines: (response: Response) => Line[];
  readSince: (since: string | undefined) => Promise<Response>;
  readTimestamp: (line: Line) => string;
  renderInitial: (response: Response) => string;
  renderLines: (response: Response, lines: Line[]) => string;
}

export async function followLogsWithPolling<Response, Line>(
  input: FollowLogsWithPollingInput<Response, Line>,
): Promise<void> {
  const abortController: AbortController = createFollowAbortController(input.io.stdin);

  try {
    let cursor: LogsFollowCursor = await writeInitialFollowOutput(input);

    while (!abortController.signal.aborted) {
      cursor = await pollFollowOutput(input, abortController.signal, cursor);
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      throw error;
    }
  } finally {
    removeFollowSignalListeners(abortController);
  }
}

async function writeInitialFollowOutput<Response, Line>(
  input: FollowLogsWithPollingInput<Response, Line>,
): Promise<LogsFollowCursor> {
  const response: Response = await input.readInitial();
  writeLogsMessage(input.io, input.renderInitial(response));
  return advanceLogsFollowCursor(
    createEmptyLogsFollowCursor(),
    input.readLines(response),
    input.readTimestamp,
    input.createSignature,
  );
}

async function pollFollowOutput<Response, Line>(
  input: FollowLogsWithPollingInput<Response, Line>,
  signal: AbortSignal,
  cursor: LogsFollowCursor,
): Promise<LogsFollowCursor> {
  await sleep(input.pollIntervalMs ?? defaultFollowPollIntervalMs, undefined, { signal });

  const response: Response = await input.readSince(cursor.lastTimestamp ?? undefined);
  const lines: Line[] = input.readLines(response);
  const newLines: Line[] = filterUnreadFollowLines(lines, cursor, input.readTimestamp, input.createSignature);
  if (newLines.length > 0) {
    writeLogsMessage(input.io, input.renderLines(response, newLines));
  }

  return advanceLogsFollowCursor(cursor, lines, input.readTimestamp, input.createSignature);
}

function createFollowAbortController(stdin: NodeJS.ReadableStream): AbortController {
  const abortController: AbortController = new AbortController();
  const abort: () => void = (): void => abortController.abort();

  stdin.once('close', abort);
  stdin.once('end', abort);
  stdin.once('finish', abort);
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  followAbortListeners.set(abortController, { abort, stdin });
  return abortController;
}

function removeFollowSignalListeners(abortController: AbortController): void {
  const registration: FollowAbortRegistration | undefined = followAbortListeners.get(abortController);
  if (registration === undefined) {
    return;
  }

  registration.stdin.off('close', registration.abort);
  registration.stdin.off('end', registration.abort);
  registration.stdin.off('finish', registration.abort);
  process.off('SIGINT', registration.abort);
  process.off('SIGTERM', registration.abort);
  followAbortListeners.delete(abortController);
}

function writeLogsMessage(io: CliIo, text: string): void {
  if (text !== '') {
    io.stdout(`${text}\n`);
  }
}

function createEmptyLogsFollowCursor(): LogsFollowCursor {
  return {
    lastTimestamp: null,
    seenCountsAtTimestamp: new Map<string, number>(),
  };
}

function filterUnreadFollowLines<Line>(
  lines: Line[],
  cursor: LogsFollowCursor,
  readTimestamp: (line: Line) => string,
  createSignature: (line: Line) => string,
): Line[] {
  if (cursor.lastTimestamp === null) {
    return lines;
  }

  const pendingCounts: Map<string, number> = new Map<string, number>(cursor.seenCountsAtTimestamp);
  return lines.filter(
    (line: Line): boolean =>
      !consumeSeenFollowLine(line, cursor.lastTimestamp!, pendingCounts, readTimestamp, createSignature),
  );
}

function consumeSeenFollowLine<Line>(
  line: Line,
  lastTimestamp: string,
  pendingCounts: Map<string, number>,
  readTimestamp: (line: Line) => string,
  createSignature: (line: Line) => string,
): boolean {
  if (readTimestamp(line) !== lastTimestamp) {
    return false;
  }

  const signature: string = createSignature(line);
  const seenCount: number = pendingCounts.get(signature) ?? 0;
  if (seenCount === 0) {
    return false;
  }

  pendingCounts.set(signature, seenCount - 1);
  return true;
}

function advanceLogsFollowCursor<Line>(
  cursor: LogsFollowCursor,
  lines: Line[],
  readTimestamp: (line: Line) => string,
  createSignature: (line: Line) => string,
): LogsFollowCursor {
  const lastLine: Line | undefined = lines.at(-1);
  if (lastLine === undefined) {
    return cursor;
  }

  const lastTimestamp: string = readTimestamp(lastLine);
  return {
    lastTimestamp,
    seenCountsAtTimestamp: countFollowLinesAtTimestamp(lines, lastTimestamp, readTimestamp, createSignature),
  };
}

function countFollowLinesAtTimestamp<Line>(
  lines: Line[],
  timestamp: string,
  readTimestamp: (line: Line) => string,
  createSignature: (line: Line) => string,
): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const line of lines) {
    if (readTimestamp(line) !== timestamp) {
      continue;
    }

    const signature: string = createSignature(line);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  return counts;
}

const followAbortListeners: WeakMap<AbortController, FollowAbortRegistration> = new WeakMap<
  AbortController,
  FollowAbortRegistration
>();
