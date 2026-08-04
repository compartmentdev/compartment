import type { Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

export async function replaceInstallerTerminal(
  scriptText: string,
  terminalPath: string,
  terminalOutputPath: string,
): Promise<string> {
  try {
    const terminalOutput: Stats = await stat(terminalOutputPath);
    if (terminalOutput.isDirectory() || (terminalOutput.mode & 0o222) === 0) {
      const rejectedWritePath: string = `${terminalPath}.write-denied/tty`;
      return scriptText.replaceAll('</dev/tty', `<${terminalPath}`).replaceAll('>/dev/tty', `>${rejectedWritePath}`);
    }
  } catch {
    return scriptText.replaceAll('</dev/tty', `<${terminalPath}`).replaceAll('>/dev/tty', `>>${terminalOutputPath}`);
  }
  return scriptText.replaceAll('</dev/tty', `<${terminalPath}`).replaceAll('>/dev/tty', `>>${terminalOutputPath}`);
}

export async function readOptionalText(path: string | undefined): Promise<string> {
  if (path === undefined) {
    return '';
  }
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const caughtError: NodeJS.ErrnoException | Error = error as NodeJS.ErrnoException | Error;
    if (isMissingFileError(caughtError) || isDirectoryReadError(caughtError)) {
      return '';
    }
    throw error;
  }
}

export function readExecFileOutput(output: Buffer | string | undefined): string {
  return Buffer.isBuffer(output) ? output.toString('utf8') : (output ?? '');
}

export function isMissingFileError(error: NodeJS.ErrnoException | Error): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isDirectoryReadError(error: NodeJS.ErrnoException | Error): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EISDIR';
}
