import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRequiredSelfHostedInstall } from '../src/self-hosted-install-read';
import type { ReadSelfHostedInstallResult } from '../src/self-hosted-install-read.types';

describe('self-hosted install read', (): void => {
  const temporaryDirectories: string[] = [];

  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('falls back to legacy on-prem install paths when reading existing installs', async (): Promise<void> => {
    const temporaryDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-install-read-'));
    temporaryDirectories.push(temporaryDirectory);
    const configDir: string = join(temporaryDirectory, 'etc');
    const dataDir: string = join(temporaryDirectory, 'var');
    await mkdir(configDir, { recursive: true });
    await mkdir(join(dataDir, 'onprem'), { recursive: true });
    await writeFile(join(configDir, '.env.onprem'), 'COMPARTMENT_ENV=self-hosted\n', 'utf8');
    await writeFile(
      join(dataDir, 'onprem/install-state.json'),
      `${JSON.stringify(
        {
          imageSource: 'registry',
          installationId: '11111111-1111-4111-8111-111111111111',
          stateVersion: 1,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result: ReadSelfHostedInstallResult = await readRequiredSelfHostedInstall({
      configDir,
      dataDir,
    });

    expect(result.environmentText).toBe('COMPARTMENT_ENV=self-hosted\n');
    expect(result.installPaths.statePath).toBe(join(dataDir, 'onprem/install-state.json'));
    expect(result.installPaths.stagedAssetPaths.envPath).toBe(join(configDir, '.env.onprem'));
    expect(result.state.installationId).toBe('11111111-1111-4111-8111-111111111111');
  });
});
