import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveKubernetesBuildRuntimeClassName } from '../src/services/kubernetes-build-runtime-values.service';

describe('Kubernetes build RuntimeClass values', (): void => {
  it('uses the chart default when operator values omit the setting', async (): Promise<void> => {
    const valuesFile: TemporaryValuesFile = await writeValues('{}\n');
    try {
      await expect(
        resolveKubernetesBuildRuntimeClassName({ buildkit: { runtimeClassName: 'custom-sandbox' } }, valuesFile.path),
      ).resolves.toBe('custom-sandbox');
    } finally {
      await rm(valuesFile.directory, { force: true, recursive: true });
    }
  });

  it('allows operator values to clear a nonempty chart default', async (): Promise<void> => {
    const valuesFile: TemporaryValuesFile = await writeValues("buildkit:\n  runtimeClassName: ''\n");
    try {
      await expect(
        resolveKubernetesBuildRuntimeClassName({ buildkit: { runtimeClassName: 'custom-sandbox' } }, valuesFile.path),
      ).resolves.toBe('');
    } finally {
      await rm(valuesFile.directory, { force: true, recursive: true });
    }
  });

  it('preserves the exact value that Helm will render', async (): Promise<void> => {
    const valuesFile: TemporaryValuesFile = await writeValues("buildkit:\n  runtimeClassName: ' gvisor '\n");
    try {
      await expect(resolveKubernetesBuildRuntimeClassName({}, valuesFile.path)).resolves.toBe(' gvisor ');
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
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-build-runtime-values-'));
  const path: string = join(directory, 'values.yaml');
  await writeFile(path, contents, 'utf8');
  return { directory, path };
}
