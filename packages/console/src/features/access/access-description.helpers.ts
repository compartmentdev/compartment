export function normalizeOptionalDescription(description: string): string | null {
  return description.trim() === '' ? null : description;
}
