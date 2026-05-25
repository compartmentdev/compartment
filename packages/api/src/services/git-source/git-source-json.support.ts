import { hasText } from '@compartment/utils';

export function readGitSourceJsonStringArray(value: string): string[] {
  try {
    const parsed: string[] | null = JSON.parse(value) as string[] | null;
    return Array.isArray(parsed) ? parsed.filter(hasText) : [];
  } catch {
    return [];
  }
}
