import { readRequiredDurationMs } from './read-required-duration-ms';

export function parseSessionTtl(value: string): number {
  return readRequiredDurationMs(value, 'COMPARTMENT_SESSION_TTL');
}

export function normalizeApiHostValue(value: string): string {
  return value.trim().toLowerCase();
}

export function readOptionalConfigText(value: string | undefined): string | null {
  const normalizedValue: string = value?.trim() ?? '';
  return normalizedValue === '' ? null : normalizedValue;
}
