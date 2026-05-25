export function readNextAccessOptionId(options: readonly { id: string }[], current: string): string {
  if (current !== '' && options.some((option: { id: string }): boolean => option.id === current)) {
    return current;
  }

  return options[0]?.id ?? '';
}
