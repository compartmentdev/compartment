import { hasText } from '@compartment/utils';

export function splitCommaSeparatedValues(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry: string): string => entry.trim())
    .filter(hasText);
}
