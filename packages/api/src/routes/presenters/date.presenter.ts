export function toNullableIsoString(value: Date | null): string | null {
  return value !== null ? value.toISOString() : null;
}
