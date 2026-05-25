import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface SeaModule {
  isSeaRuntime: () => boolean;
  readSeaAssetBuffer: (assetName: string) => Buffer | undefined;
}

const extractedDirectories: string[] = [];
const originalXdgCacheHome: string | undefined = process.env.XDG_CACHE_HOME;

afterEach(async (): Promise<void> => {
  vi.resetModules();
  vi.doUnmock('../src/sea');
  if (originalXdgCacheHome === undefined) {
    delete process.env.XDG_CACHE_HOME;
  } else {
    process.env.XDG_CACHE_HOME = originalXdgCacheHome;
  }
  await Promise.all(
    extractedDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  extractedDirectories.length = 0;
});

describe('bundled cosign', (): void => {
  it('uses PATH cosign outside the SEA binary', async (): Promise<void> => {
    vi.doMock(
      '../src/sea',
      (): SeaModule => ({
        isSeaRuntime: (): boolean => false,
        readSeaAssetBuffer: (): Buffer | undefined => undefined,
      }),
    );

    const { readCosignCommand } = await import('../src/bundled-cosign');

    await expect(readCosignCommand()).resolves.toEqual(['cosign']);
  });

  it('extracts the embedded cosign binary as an owner-only executable inside the SEA binary', async (): Promise<void> => {
    const cosignAsset: Buffer = Buffer.from('#!/bin/sh\nexit 0\n');
    const cacheDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cosign-cache-'));
    process.env.XDG_CACHE_HOME = cacheDirectory;
    extractedDirectories.push(cacheDirectory);
    vi.doMock(
      '../src/sea',
      (): SeaModule => ({
        isSeaRuntime: (): boolean => true,
        readSeaAssetBuffer: (assetName: string): Buffer | undefined =>
          assetName === 'cosign' ? cosignAsset : undefined,
      }),
    );

    const { readCosignCommand } = await import('../src/bundled-cosign');

    const command: readonly string[] = await readCosignCommand();
    const cosignPath: string = command[0] ?? '';

    expect(command).toHaveLength(1);
    expect(cosignPath.startsWith(join(cacheDirectory, 'compartment', 'cosign'))).toBe(true);
    await expect(readFile(cosignPath, 'utf8')).resolves.toBe(cosignAsset.toString('utf8'));
    expect((await stat(dirname(cosignPath))).mode & 0o777).toBe(0o700);
    expect((await stat(cosignPath)).mode & 0o777).toBe(0o700);
  });

  it('fails when the SEA binary does not contain cosign', async (): Promise<void> => {
    vi.doMock(
      '../src/sea',
      (): SeaModule => ({
        isSeaRuntime: (): boolean => true,
        readSeaAssetBuffer: (): Buffer | undefined => undefined,
      }),
    );

    const { readCosignCommand } = await import('../src/bundled-cosign');

    await expect(readCosignCommand()).rejects.toThrow('Missing embedded CLI asset cosign.');
  });
});
