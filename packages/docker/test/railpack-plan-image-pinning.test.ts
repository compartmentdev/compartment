import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pinRailpackPlanImages } from '../src/railpack-plan-image-pinning';

const builderImage: string = `ghcr.io/railwayapp/railpack-builder@sha256:${'a'.repeat(64)}`;
const runtimeImage: string = `ghcr.io/railwayapp/railpack-runtime@sha256:${'b'.repeat(64)}`;

describe('Railpack plan image pinning', (): void => {
  it('replaces mutable Railpack base tags with the configured digests', async (): Promise<void> => {
    const fixture: PlanFixture = await writePlan({
      steps: [
        { inputs: [{ image: 'ghcr.io/railwayapp/railpack-builder:mise-current' }] },
        { inputs: [{ image: 'ghcr.io/railwayapp/railpack-runtime:mise-current' }, { local: true }] },
      ],
    });
    try {
      await pinRailpackPlanImages(fixture.path, { builder: builderImage, runtime: runtimeImage });
      const rendered: string = await readFile(fixture.path, 'utf8');
      expect(rendered).toContain(`"image": "${builderImage}"`);
      expect(rendered).toContain(`"image": "${runtimeImage}"`);
      expect(rendered).not.toContain('mise-current');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('pins a builder-only static plan without requiring an unused runtime image', async (): Promise<void> => {
    const fixture: PlanFixture = await writePlan({
      steps: [{ inputs: [{ image: 'ghcr.io/railwayapp/railpack-builder:mise-current' }] }],
    });
    try {
      await pinRailpackPlanImages(fixture.path, { builder: builderImage, runtime: runtimeImage });
      const rendered: string = await readFile(fixture.path, 'utf8');
      expect(rendered).toContain(`"image": "${builderImage}"`);
      expect(rendered).not.toContain(runtimeImage);
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it('fails closed when Railpack stops emitting the expected builder image', async (): Promise<void> => {
    const fixture: PlanFixture = await writePlan({
      steps: [{ inputs: [{ image: 'ghcr.io/railwayapp/railpack-runtime:mise-current' }] }],
    });
    try {
      await expect(
        pinRailpackPlanImages(fixture.path, { builder: builderImage, runtime: runtimeImage }),
      ).rejects.toThrow('must reference the configured builder');
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });
});

interface PlanFixture {
  directory: string;
  path: string;
}

async function writePlan(plan: object): Promise<PlanFixture> {
  const directory: string = await mkdtemp(join(tmpdir(), 'railpack-plan-pinning-'));
  const path: string = join(directory, 'railpack-plan.json');
  await writeFile(path, JSON.stringify(plan), 'utf8');
  return { directory, path };
}
