import { normalizeNanosecondZuluTimestamp } from '@compartment/utils';

export function compareLogTimestamps(left: string, right: string): number {
  const normalizedLeft: string | null = normalizeNanosecondZuluTimestamp(left);
  const normalizedRight: string | null = normalizeNanosecondZuluTimestamp(right);
  if (normalizedLeft !== null && normalizedRight !== null) {
    return normalizedLeft.localeCompare(normalizedRight);
  }

  return Date.parse(left) - Date.parse(right);
}
