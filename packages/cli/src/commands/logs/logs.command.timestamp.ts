import { normalizeNanosecondZuluTimestamp } from '@compartment/utils';

export function normalizeLogsFollowTimestamp(timestamp: string): string {
  return normalizeNanosecondZuluTimestamp(timestamp) ?? timestamp;
}
