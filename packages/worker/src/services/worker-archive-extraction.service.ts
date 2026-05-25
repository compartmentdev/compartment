import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

export async function extractTarArchiveWithoutSameOwner(
  archivePath: string,
  extractionDirectory: string,
): Promise<void> {
  await executeFileAsync('tar', buildTarArchiveExtractionArgs(archivePath, extractionDirectory));
}

function buildTarArchiveExtractionArgs(archivePath: string, extractionDirectory: string): string[] {
  return ['--no-same-owner', '-xzf', archivePath, '-C', extractionDirectory];
}
