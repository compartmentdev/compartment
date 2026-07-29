import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveKubernetesInstallRegistryConfiguration } from '../src/services/kubernetes-install-registry.service';

const temporaryDirectories: string[] = [];

describe('Kubernetes install registry values', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('derives the operator registry hostname and inherits the platform issuer', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'tls:\n  issuerRef:\n    kind: ClusterIssuer\n    name: letsencrypt-production\n',
    );

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: '178-105-136-147.sslip.io',
        domainMode: 'custom',
        valuesPath,
      }),
    ).resolves.toEqual({
      registryHostname: 'registry.178-105-136-147.sslip.io',
      registryIssuerRef: {
        group: 'cert-manager.io',
        kind: 'ClusterIssuer',
        name: 'letsencrypt-production',
      },
    });
  });

  it('uses a dedicated registry issuer with an operator TLS Secret', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'tls:\n  existingSecret: operator-platform-tls\nregistry:\n  issuerRef:\n    kind: Issuer\n    name: registry-issuer\n',
    );

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath,
      }),
    ).resolves.toMatchObject({
      registryHostname: 'registry.apps.example.com',
      registryIssuerRef: { kind: 'Issuer', name: 'registry-issuer' },
    });
  });

  it('rejects a registry hostname that diverges from the operator base domain', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'tls:\n  issuerRef:\n    kind: Issuer\n    name: platform-issuer\nregistry:\n  hostname: registry.other.example\n',
    );

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath,
      }),
    ).rejects.toThrow('registry.hostname must be registry.apps.example.com');
  });

  it('fails before cluster mutation when an interactive public operator install has no TLS ownership', async (): Promise<void> => {
    const valuesPath: string = await writeValues('{}\n');

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath,
      }),
    ).rejects.toThrow(
      'tls.issuerRef or tls.existingSecret is required in --values for an operator-owned public base domain.',
    );
  });

  it('requires a dedicated registry issuer when public TLS uses an existing Secret', async (): Promise<void> => {
    const valuesPath: string = await writeValues('tls:\n  existingSecret: operator-platform-tls\n');

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath,
      }),
    ).rejects.toThrow('registry.issuerRef is required in --values when operator TLS uses tls.existingSecret');
  });

  it('defers a managed registry hostname until the broker allocates the base domain', async (): Promise<void> => {
    const valuesPath: string = await writeValues('{}\n');

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        domainMode: 'managed',
        valuesPath,
      }),
    ).resolves.toEqual({
      registryHostname: '',
      registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    });
  });
});

async function writeValues(contents: string): Promise<string> {
  const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-install-registry-'));
  temporaryDirectories.push(directory);
  const valuesPath: string = resolve(directory, 'values.yaml');
  await writeFile(valuesPath, contents, 'utf8');
  return valuesPath;
}
