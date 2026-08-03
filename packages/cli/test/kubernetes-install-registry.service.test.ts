import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveKubernetesInstallRegistryConfiguration } from '../src/services/kubernetes-install-registry.service';
import type { KubernetesInstallRegistryConfiguration } from '../src/services/kubernetes-install-registry.service.types';

const temporaryDirectories: string[] = [];

describe('Kubernetes install registry values', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('defers the custom registry address and inherits the platform issuer without using the base domain', async (): Promise<void> => {
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
      registryHostname: '',
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
      registryHostname: '',
      registryIssuerRef: { kind: 'Issuer', name: 'registry-issuer' },
    });
  });

  it('rejects a configured registry hostname in both domain modes', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'tls:\n  issuerRef:\n    kind: Issuer\n    name: platform-issuer\nregistry:\n  hostname: registry.other.example\n',
    );

    const customResolution: Promise<KubernetesInstallRegistryConfiguration> =
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath,
      });
    const managedResolution: Promise<KubernetesInstallRegistryConfiguration> =
      resolveKubernetesInstallRegistryConfiguration({
        domainMode: 'managed',
        valuesPath,
      });

    await expect(customResolution).rejects.toThrow(
      'registry.hostname is derived from the retained registry Service ClusterIP',
    );
    await expect(managedResolution).rejects.toThrow(
      'registry.hostname is derived from the retained registry Service ClusterIP',
    );
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

  it('requires a node-trusted registry CA issuer for managed mode', async (): Promise<void> => {
    const valuesPath: string = await writeValues('{}\n');

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        domainMode: 'managed',
        valuesPath,
      }),
    ).rejects.toThrow('must reference a CA trusted by every Kubernetes node');
  });
});

async function writeValues(contents: string): Promise<string> {
  const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-install-registry-'));
  temporaryDirectories.push(directory);
  const valuesPath: string = resolve(directory, 'values.yaml');
  await writeFile(valuesPath, contents, 'utf8');
  return valuesPath;
}
