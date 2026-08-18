import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveKubernetesSandboxRuntimeClassNames } from '../src/services/kubernetes-sandbox-runtime-values.service';

describe('Kubernetes sandbox RuntimeClass values', (): void => {
  it('uses the chart default when operator values omit the setting', async (): Promise<void> => {
    const valuesFile: TemporaryValuesFile = await writeValues('{}\n');
    try {
      await expect(
        resolveKubernetesSandboxRuntimeClassNames(
          { sandboxRuntime: { buildRuntimeClassName: 'gvisor-build', runtimeClassName: 'gvisor' } },
          valuesFile.path,
        ),
      ).resolves.toEqual({ build: 'gvisor-build', tenant: 'gvisor' });
    } finally {
      await rm(valuesFile.directory, { force: true, recursive: true });
    }
  });

  it('resolves separate operator-provided RuntimeClasses for builds and tenant workloads', async (): Promise<void> => {
    const valuesFile: TemporaryValuesFile = await writeValues(
      "sandboxRuntime:\n  buildRuntimeClassName: 'gke-gvisor-build'\n  runtimeClassName: 'gke-gvisor'\n",
    );
    try {
      await expect(
        resolveKubernetesSandboxRuntimeClassNames(
          { sandboxRuntime: { buildRuntimeClassName: 'gvisor-build', runtimeClassName: 'gvisor' } },
          valuesFile.path,
        ),
      ).resolves.toEqual({ build: 'gke-gvisor-build', tenant: 'gke-gvisor' });
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
