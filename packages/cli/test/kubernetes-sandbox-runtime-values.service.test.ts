import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveKubernetesSandboxRuntimeClassName } from '../src/services/kubernetes-sandbox-runtime-values.service';

describe('Kubernetes sandbox RuntimeClass values', (): void => {
  it('uses the chart default when operator values omit the setting', async (): Promise<void> => {
    const valuesFile: TemporaryValuesFile = await writeValues('{}\n');
    try {
      await expect(
        resolveKubernetesSandboxRuntimeClassName({ sandboxRuntime: { runtimeClassName: 'gvisor' } }, valuesFile.path),
      ).resolves.toBe('gvisor');
    } finally {
      await rm(valuesFile.directory, { force: true, recursive: true });
    }
  });

  it('uses one operator-provided RuntimeClass for all sandboxed workloads', async (): Promise<void> => {
    const valuesFile: TemporaryValuesFile = await writeValues("sandboxRuntime:\n  runtimeClassName: 'gke-gvisor'\n");
    try {
      await expect(
        resolveKubernetesSandboxRuntimeClassName({ sandboxRuntime: { runtimeClassName: 'gvisor' } }, valuesFile.path),
      ).resolves.toBe('gke-gvisor');
    } finally {
      await rm(valuesFile.directory, { force: true, recursive: true });
    }
  });
});

interface TemporaryValuesFile {
  directory: string;
  path: string;
}

async function writeValues(contents: string): Promise<TemporaryValuesFile> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-sandbox-runtime-values-'));
  const path: string = join(directory, 'values.yaml');
  await writeFile(path, contents, 'utf8');
  return { directory, path };
}
