import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { usesOperatorOwnedKubernetesTlsSecret } from '../src/services/kubernetes-install-tls.service';

const temporaryDirectories: string[] = [];

describe('Kubernetes install TLS values', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('detects an operator-owned TLS Secret reference', async (): Promise<void> => {
    const valuesPath: string = await writeValues('tls:\n  existingSecret: operator-platform-tls\n');

    await expect(usesOperatorOwnedKubernetesTlsSecret(valuesPath)).resolves.toBe(true);
  });

  it('does not treat an empty TLS Secret reference as operator-owned', async (): Promise<void> => {
    const valuesPath: string = await writeValues('tls:\n  existingSecret: ""\n');

    await expect(usesOperatorOwnedKubernetesTlsSecret(valuesPath)).resolves.toBe(false);
  });
});

async function writeValues(contents: string): Promise<string> {
  const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-install-tls-'));
  temporaryDirectories.push(directory);
  const valuesPath: string = resolve(directory, 'values.yaml');
  await writeFile(valuesPath, contents, 'utf8');
  return valuesPath;
}
