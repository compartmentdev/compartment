import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pinRailpackPlanImages } from '../src/docker-railpack-image-pins';

const temporaryDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path: string): Promise<void> => await rm(path, { recursive: true })),
  );
});

describe('pinRailpackPlanImages', (): void => {
  it('replaces generated builder and runtime tags with immutable digests', async (): Promise<void> => {
    const directory: string = await mkdtemp(join(tmpdir(), 'railpack-pins-'));
    temporaryDirectories.push(directory);
    const planPath: string = join(directory, 'plan.json');
    await writeFile(
      planPath,
      JSON.stringify({
        steps: [{ inputs: [{ image: 'ghcr.io/railwayapp/railpack-builder:mise-2026.3.17' }] }],
        deploy: { inputs: [{ image: 'ghcr.io/railwayapp/railpack-runtime:mise-2026.3.17' }] },
      }),
    );

    await pinRailpackPlanImages(planPath);

    const plan: string = await readFile(planPath, 'utf8');
    expect(plan).not.toContain(':mise-2026.3.17');
    expect(plan).toMatch(/railpack-builder@sha256:[a-f0-9]{64}/u);
    expect(plan).toMatch(/railpack-runtime@sha256:[a-f0-9]{64}/u);
  });

  it('rejects an unrecognized Railpack builder or runtime image', async (): Promise<void> => {
    const directory: string = await mkdtemp(join(tmpdir(), 'railpack-pins-'));
    temporaryDirectories.push(directory);
    const planPath: string = join(directory, 'plan.json');
    await writeFile(
      planPath,
      JSON.stringify({ steps: [{ inputs: [{ image: 'ghcr.io/railwayapp/railpack-builder:mise-next' }] }] }),
    );

    await expect(pinRailpackPlanImages(planPath)).rejects.toThrow('without an approved immutable pin');
  });
});
