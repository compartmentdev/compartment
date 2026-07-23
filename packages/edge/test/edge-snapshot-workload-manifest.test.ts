import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifestPath: string = resolve(__dirname, '../manifests/edge-snapshot-workload.projection.yaml');

describe('edge snapshot workload manifest', (): void => {
  it('pins the snapshot ownership init image by digest', async (): Promise<void> => {
    const manifest: string = await readFile(manifestPath, 'utf8');

    expect(manifest).toMatch(/image: busybox:1\.37\.0@sha256:[a-f0-9]{64}/u);
  });
});
