export function boundRegistryDiagnostic(message: string): string {
  const compact: string = message.replaceAll(/\s+/gu, ' ').trim();
  return compact.length <= 500 ? compact : `${compact.slice(0, 497)}...`;
}

export function readRegistryDiagnosticFailure(exitCode: number, stderr: string, stdout: string): string {
  const errorOutput: string = stderr.trim();
  const output: string = errorOutput === '' ? stdout.trim() : errorOutput;
  return output === '' ? `command exited with status ${exitCode.toString()}` : output;
}
