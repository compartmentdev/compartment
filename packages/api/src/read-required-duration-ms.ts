import { parse as parseDuration } from '@lukeed/ms';

export function readRequiredDurationMs(value: string, variableName: string): number {
  const durationMs: number | undefined = parseDuration(value);
  if (durationMs === undefined || durationMs <= 0) {
    throw new Error(`${variableName} must be a positive duration like 30m, 24h, or 7d.`);
  }

  return durationMs;
}
