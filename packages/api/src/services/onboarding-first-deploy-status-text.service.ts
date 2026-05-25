const firstDeployFailedStatusPrefix: string = 'First deploy failed';
const maxFirstDeployFailureDetailLength: number = 240;

export function readFirstDeployFailureStatusText(failureMessage: string | null): string {
  const detail: string | null = readFirstDeployFailureDetail(failureMessage);
  if (detail === null) {
    return `${firstDeployFailedStatusPrefix}.`;
  }

  return `${firstDeployFailedStatusPrefix}: ${detail}${hasTerminalPunctuation(detail) ? '' : '.'}`;
}

function readFirstDeployFailureDetail(failureMessage: string | null): string | null {
  if (failureMessage === null || failureMessage.trim() === '') {
    return null;
  }
  const detail: string = normalizeFailureDetail(readFirstFailureLine(failureMessage));
  return detail === '' ? null : truncateFailureDetail(detail);
}

function readFirstFailureLine(message: string): string {
  return message.split(/\r?\n/u)[0] ?? message;
}

function normalizeFailureDetail(value: string): string {
  return value
    .replace(/^\[(?:stderr|stdout)\]\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncateFailureDetail(detail: string): string {
  return detail.length <= maxFirstDeployFailureDetailLength
    ? detail
    : `${detail.slice(0, maxFirstDeployFailureDetailLength - 1).trimEnd()}...`;
}

function hasTerminalPunctuation(value: string): boolean {
  return /[.!?]$/u.test(value);
}
