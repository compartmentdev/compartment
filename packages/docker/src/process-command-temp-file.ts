import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcessCommand } from './process-command';

const processCommandTempDirPrefix: string = 'compartment-command-';

interface ProcessCommandTempFileInput {
  args: readonly string[];
  content: string;
  file: string;
  fileName: string;
}

export async function runProcessCommandWithTempFile(input: ProcessCommandTempFileInput): Promise<void> {
  const directoryPath: string = await mkdtemp(join(tmpdir(), processCommandTempDirPrefix));
  const filePath: string = join(directoryPath, input.fileName);
  try {
    await writeFile(filePath, input.content);
    await runProcessCommand({
      args: [...input.args, filePath],
      file: input.file,
    });
  } finally {
    await rm(directoryPath, { force: true, recursive: true });
  }
}
