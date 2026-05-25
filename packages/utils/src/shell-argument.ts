const safeShellArgumentPattern: RegExp = /^[A-Za-z0-9_./:=@+-]+$/u;

export function quoteShellArgumentWhenNeeded(value: string): string {
  return safeShellArgumentPattern.test(value) ? value : quoteShellArgument(value);
}

export function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
