const zuluTimestampPattern: RegExp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

export function normalizeNanosecondZuluTimestamp(timestamp: string): string | null {
  const match: RegExpExecArray | null = zuluTimestampPattern.exec(timestamp);
  if (match === null) {
    return null;
  }

  return `${match[1]}.${(match[2] ?? '').padEnd(9, '0')}Z`;
}
