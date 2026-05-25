const ellipsisWidth: number = 3;

export function formatFixedWidthColumn(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width, ' ');
  }

  return `${value.slice(0, width - ellipsisWidth)}...`;
}
