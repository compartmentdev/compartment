import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readCosignCommand } from '../src/bundled-cosign';

interface SeaMocks {
  isSeaRuntime: Mock<() => boolean>;
  readSeaAssetBuffer: Mock<(assetName: string) => Buffer | undefined>;
}

const mocks: SeaMocks = vi.hoisted(
  (): SeaMocks => ({
    isSeaRuntime: vi.fn<() => boolean>(),
    readSeaAssetBuffer: vi.fn<(assetName: string) => Buffer | undefined>(),
  }),
);

vi.mock('../src/sea', (): SeaMocks => mocks);

describe('bundled cosign', (): void => {
  afterEach((): void => {
    vi.unstubAllEnvs();
    mocks.isSeaRuntime.mockReset();
    mocks.readSeaAssetBuffer.mockReset();
  });

  it('extracts the SEA asset once into the user cache as an executable', async (): Promise<void> => {
    const cachePath: string = resolve(tmpdir(), `compartment-cosign-test-${process.pid}-${Date.now()}`);
    const asset: Buffer = Buffer.from('#!/bin/sh\nexit 0\n');
    vi.stubEnv('XDG_CACHE_HOME', cachePath);
    mocks.isSeaRuntime.mockReturnValue(true);
    mocks.readSeaAssetBuffer.mockReturnValue(asset);

    try {
      const firstCommand: readonly string[] = await readCosignCommand();
      const secondCommand: readonly string[] = await readCosignCommand();
      const executablePath: string | undefined = firstCommand[0];

      expect(executablePath).toBeDefined();
      expect(secondCommand).toEqual(firstCommand);
      expect(mocks.readSeaAssetBuffer).toHaveBeenCalledOnce();
      expect(await readFile(executablePath!)).toEqual(asset);
      expect((await stat(executablePath!)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(cachePath, { force: true, recursive: true });
    }
  });
});
