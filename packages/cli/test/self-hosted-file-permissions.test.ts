import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSelfHostedPrivateDirectory, writeSelfHostedPrivateFile } from '../src/self-hosted-file-permissions';

describe('self-hosted private file permissions', (): void => {
  let tempDirectory: string | undefined;

  afterEach(async (): Promise<void> => {
    if (tempDirectory !== undefined) {
      await rm(tempDirectory, { force: true, recursive: true });
      tempDirectory = undefined;
    }
  });

  it('writes private files and directories with restricted modes', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-self-hosted-permissions-'));
    const filePath: string = join(tempDirectory, 'etc', 'compartment', '.env.self-hosted');

    await writeSelfHostedPrivateFile(filePath, 'COMPARTMENT_BASE_DOMAIN=localhost\n');

    await expect(readFile(filePath, 'utf8')).resolves.toBe('COMPARTMENT_BASE_DOMAIN=localhost\n');
    expect((await stat(join(tempDirectory, 'etc', 'compartment'))).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it('refuses symlink private directories before chmod or writes', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-self-hosted-permissions-'));
    const targetPath: string = join(tempDirectory, 'target');
    const linkPath: string = join(tempDirectory, 'link');
    await mkdir(targetPath);
    await symlink(targetPath, linkPath);

    await expect(ensureSelfHostedPrivateDirectory(linkPath)).rejects.toThrow(
      `Compartment private directory ${linkPath} must be a real directory.`,
    );
  });

  it('refuses symlink private file targets', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-self-hosted-permissions-'));
    const realFilePath: string = join(tempDirectory, 'real.env');
    const linkPath: string = join(tempDirectory, '.env.self-hosted');
    await writeFile(realFilePath, 'old=value\n');
    await symlink(realFilePath, linkPath);

    await expect(writeSelfHostedPrivateFile(linkPath, 'new=value\n')).rejects.toThrow(
      `Compartment private file ${linkPath} must be a real file.`,
    );
    await expect(readFile(realFilePath, 'utf8')).resolves.toBe('old=value\n');
  });
});
