export function normalizeBrowserSearchQuery(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
