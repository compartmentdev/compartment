export function normalizeDescription(description: string | null | undefined): string | null {
  return description == null || description.trim() === '' ? null : description.trim();
}
