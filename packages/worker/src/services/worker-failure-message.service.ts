import { readNodeRequestRuntimeMessage } from '@compartment/sdk';

export function readWorkerFailureMessage(error: Error | undefined, fallbackMessage: string): string {
  if (error === undefined) {
    return fallbackMessage;
  }

  return readRuntimeFailureSummary(readNodeRequestRuntimeMessage(error) ?? error.message);
}

function readRuntimeFailureSummary(message: string): string {
  return readLastRuntimeLogLine(message) ?? message;
}

function readLastRuntimeLogLine(message: string): string | null {
  const lastLogsIndex: number = message.lastIndexOf('Last logs:');
  if (lastLogsIndex === -1) {
    return null;
  }
  const logBlock: string = message.slice(lastLogsIndex + 'Last logs:'.length);
  return (
    logBlock
      .split(/\r?\n/u)
      .map(normalizeRuntimeLogLine)
      .filter((line: string): boolean => line !== '')
      .at(-1) ?? null
  );
}

function normalizeRuntimeLogLine(value: string): string {
  return value
    .replace(/^\[(?:stderr|stdout)\]\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
