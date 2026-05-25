import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readVariableImportEntries } from '../src/services/variable-import-file.service';

const tempDirectories: string[] = [];

describe('variable import file service', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(tempDirectories.splice(0).map(removeTempDirectory));
  });

  it('parses multiline quoted dotenv values without false duplicate detection', async (): Promise<void> => {
    const directory: string = await createTempDirectory();
    const filePath: string = join(directory, '.env.multiline');

    await writeFile(filePath, 'PRIVATE_KEY="line1\nLOG_LEVEL=debug\nline3"\nDATABASE_URL=postgres://db\n', 'utf8');

    await expect(readVariableImportEntries(filePath)).resolves.toEqual([
      { keyName: 'PRIVATE_KEY', value: 'line1\nLOG_LEVEL=debug\nline3' },
      { keyName: 'DATABASE_URL', value: 'postgres://db' },
    ]);
  });

  it('does not report duplicates when a multiline quoted value contains another key-like line', async (): Promise<void> => {
    const directory: string = await createTempDirectory();
    const filePath: string = join(directory, '.env.multiline-embedded-key');

    await writeFile(filePath, 'CERT="-----BEGIN-----\nLOG_LEVEL=embedded\n-----END-----"\nLOG_LEVEL=info\n', 'utf8');

    await expect(readVariableImportEntries(filePath)).resolves.toEqual([
      { keyName: 'CERT', value: '-----BEGIN-----\nLOG_LEVEL=embedded\n-----END-----' },
      { keyName: 'LOG_LEVEL', value: 'info' },
    ]);
  });

  it('allows comments, blank lines, and export syntax', async (): Promise<void> => {
    const directory: string = await createTempDirectory();
    const filePath: string = join(directory, '.env.comments');

    await writeFile(filePath, '\n# comment\nexport LOG_LEVEL=debug\nDATABASE_URL=postgres://db\n', 'utf8');

    await expect(readVariableImportEntries(filePath)).resolves.toEqual([
      { keyName: 'LOG_LEVEL', value: 'debug' },
      { keyName: 'DATABASE_URL', value: 'postgres://db' },
    ]);
  });

  it('rejects duplicate imported keys', async (): Promise<void> => {
    const directory: string = await createTempDirectory();
    const filePath: string = join(directory, '.env.duplicate');

    await writeFile(filePath, 'LOG_LEVEL=info\nLOG_LEVEL=debug\n', 'utf8');

    await expect(readVariableImportEntries(filePath)).rejects.toThrow('Duplicate imported variable keys');
  });

  it('rejects unsupported shell-style lines', async (): Promise<void> => {
    const directory: string = await createTempDirectory();
    const filePath: string = join(directory, '.env.invalid');

    await writeFile(filePath, 'LOG_LEVEL=debug\necho nope\n', 'utf8');

    await expect(readVariableImportEntries(filePath)).rejects.toThrow('unsupported dotenv content');
  });
});

async function createTempDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-variable-import-file-'));
  tempDirectories.push(directory);

  return directory;
}

async function removeTempDirectory(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}
