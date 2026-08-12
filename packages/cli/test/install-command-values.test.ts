import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeInstallIssuerOverrides } from '../src/commands/install/install.command.issuer-values';
import {
  type MaterializedInstallWizardValues,
  type OperatorInstallInputValues,
  materializeInstallWizardValues,
  readOperatorInstallInputValues,
} from '../src/commands/install/install.command.values';
import { resolveKubernetesInstallRegistryConfiguration } from '../src/services/kubernetes-install-registry.service';
import {
  readKubernetesTlsIssuerReference,
  usesOperatorOwnedKubernetesTlsSecret,
} from '../src/services/kubernetes-install-tls.service';

const temporaryDirectories: string[] = [];

describe('operator install values boundary', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory: string): Promise<void> => {
        await rm(directory, { force: true, recursive: true });
      }),
    );
  });

  it('reports every missing operator-domain value in one human-readable error', async (): Promise<void> => {
    const valuesPath: string = await writeValues('tls:\n  existingSecret: platform-tls\n');

    const error: Error = await readFailure(readOperatorInstallInputValues(valuesPath, true));

    expect(error.message).toContain(`${valuesPath}: ingress: is required and must define className`);
    expect(error.message).toContain(`${valuesPath}: registry.issuerRef: is required because the private registry`);
    expect(error.message).not.toMatch(/ZodError|"code"|"expected"|"received"|at parse/u);
  });

  it('aggregates invalid nested fields with normalized paths', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'ingress:\n  className: ""\ntls:\n  issuerRef:\n    kind: Invalid\n    name: ""\n',
    );

    const error: Error = await readFailure(readOperatorInstallInputValues(valuesPath, true));

    expect(error.message).toContain(`${valuesPath}: ingress.className: must not be empty`);
    expect(error.message).toContain(`${valuesPath}: tls.issuerRef.kind: Invalid enum value`);
    expect(error.message).toContain(`${valuesPath}: tls.issuerRef.name: must not be empty`);
    expect(error.message).not.toMatch(/ZodError|"code"|"expected"|"received"|at parse/u);
  });

  it('accepts a public issuer and infers HTTPS for an operator-owned domain', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'ingress:\n  className: traefik\nregistry:\n  issuerRef:\n    kind: ClusterIssuer\n    name: registry-ca\ntls:\n  issuerRef:\n    kind: ClusterIssuer\n    name: public-acme\n',
    );

    await expect(readOperatorInstallInputValues(valuesPath, true)).resolves.toMatchObject({ publicProtocol: 'https' });
  });
  it('gives an existing Secret priority over a configured public issuer', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'ingress:\n  className: traefik\nregistry:\n  issuerRef:\n    kind: Issuer\n    name: registry-ca\ntls:\n  existingSecret: platform-tls\n  issuerRef:\n    kind: ClusterIssuer\n    name: public-acme\n',
    );
    await expect(readOperatorInstallInputValues(valuesPath, true)).resolves.toMatchObject({ publicProtocol: 'https' });
    await expect(usesOperatorOwnedKubernetesTlsSecret(valuesPath)).resolves.toBe(true);
  });
  it('materializes public and registry issuer flags without a values file', async (): Promise<void> => {
    const material: MaterializedInstallWizardValues | undefined = await materializeInstallIssuerOverrides({
      ingressClass: 'traefik',
      registryIssuer: 'Issuer/registry-ca',
      storageClass: 'fast',
      tlsIssuer: 'ClusterIssuer/public-dns01',
    });
    expect(material).toBeDefined();
    temporaryDirectories.push(material!.directory);

    await expect(readKubernetesTlsIssuerReference(material!.path)).resolves.toEqual({
      kind: 'ClusterIssuer',
      name: 'public-dns01',
    });
    await expect(readOperatorInstallInputValues(material!.path, true)).resolves.toMatchObject({
      ingressClass: 'traefik',
      publicProtocol: 'https',
      storageClass: 'fast',
    });

    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        publicProtocol: 'https',
        valuesPath: material!.path,
      }),
    ).resolves.toMatchObject({ registryIssuerRef: { kind: 'Issuer', name: 'registry-ca' } });
  });

  it.each([
    [
      'HTTPS without an existing Secret',
      'platform:\n  publicProtocol: https\n',
      'tls.existingSecret or tls.issuerRef is required when platform.publicProtocol is https',
    ],
    [
      'HTTP with an existing Secret',
      'platform:\n  publicProtocol: http\ntls:\n  existingSecret: platform-tls\n',
      'TLS sources cannot be used when platform.publicProtocol is http',
    ],
  ])('rejects %s', async (_label: string, tlsValues: string, message: string): Promise<void> => {
    const valuesPath: string = await writeValues(
      `ingress:\n  className: traefik\nregistry:\n  issuerRef:\n    kind: ClusterIssuer\n    name: registry-ca\n${tlsValues}`,
    );

    await expect(readOperatorInstallInputValues(valuesPath, true)).rejects.toThrow(message);
  });

  it('reports an invalid container and independently missing registry issuer', async (): Promise<void> => {
    const valuesPath: string = await writeValues('ingress: traefik\n');

    const error: Error = await readFailure(readOperatorInstallInputValues(valuesPath, true));

    expect(error.message).toContain(`${valuesPath}: ingress: Expected object, received string`);
    expect(error.message).toContain(`${valuesPath}: registry.issuerRef: is required because the private registry`);
  });

  it('keeps the reserved localhost path usable without public TLS values', async (): Promise<void> => {
    const valuesPath: string = await writeValues('ingress:\n  className: traefik\n');

    await expect(readOperatorInstallInputValues(valuesPath, false)).resolves.toEqual({
      clearIngressEndpoint: false,
      ingressClass: 'traefik',
      storageClass: '',
    });
  });

  it('reads a configured ingress endpoint for resume reconciliation', async (): Promise<void> => {
    const endpoint: string = [8, 8, 4, 4].join('.');
    const valuesPath: string = await writeValues(
      `ingress:\n  className: traefik\n  endpoint:\n    type: A\n    value: ${endpoint}\n`,
    );

    await expect(readOperatorInstallInputValues(valuesPath, false)).resolves.toEqual({
      clearIngressEndpoint: false,
      ingressClass: 'traefik',
      ingressEndpoint: endpoint,
      storageClass: '',
    });
  });

  it('accepts chart-aligned nested operator values', async (): Promise<void> => {
    const valuesPath: string = await writeValues(`
ingress:
  className: traefik
  endpoint:
    type: hostname
    value: ingress.apps.example.com
platform:
  publicProtocol: http
registry:
  issuerRef:
    group: cert-manager.io
    kind: ClusterIssuer
    name: registry-ca
  storage:
    backend: s3
    s3:
      bucket: compartment-registry
      region: eu-central-1
      regionEndpoint: https://s3.example.com
      forcePathStyle: true
      existingSecret: registry-s3
nodePools:
  system:
    nodeSelector:
      compartment.dev/node-pool: system
sandboxRuntime:
  runtimeClassName: gvisor
`);

    await expect(readOperatorInstallInputValues(valuesPath, true)).resolves.toMatchObject({
      ingressClass: 'traefik',
      ingressEndpoint: 'ingress.apps.example.com',
    });
    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath,
      }),
    ).resolves.toMatchObject({
      registryIssuerRef: {
        group: 'cert-manager.io',
        kind: 'ClusterIssuer',
        name: 'registry-ca',
      },
    });
  });

  it('marks an empty ingress endpoint for LoadBalancer rediscovery', async (): Promise<void> => {
    const valuesPath: string = await writeValues(
      'ingress:\n  className: traefik\n  endpoint:\n    type: ""\n    value: ""\n',
    );

    await expect(readOperatorInstallInputValues(valuesPath, false)).resolves.toMatchObject({
      clearIngressEndpoint: true,
    });
  });

  it('materializes the complete interactive operator values contract', async (): Promise<void> => {
    const material: MaterializedInstallWizardValues = await materializeInstallWizardValues({
      ingress: { className: 'traefik' },
      platform: { publicProtocol: 'http' },
      registry: { issuerRef: { kind: 'ClusterIssuer', name: 'registry-ca' } },
      storage: { storageClass: 'local-path' },
    });
    temporaryDirectories.push(material.directory);

    await expect(readOperatorInstallInputValues(material.path, true)).resolves.toEqual({
      clearIngressEndpoint: false,
      ingressClass: 'traefik',
      publicProtocol: 'http',
      storageClass: 'local-path',
    });
    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath: material.path,
      }),
    ).resolves.toMatchObject({
      registryHostname: '',
      registryIssuerRef: { kind: 'ClusterIssuer', name: 'registry-ca' },
    });
    await expect(readKubernetesTlsIssuerReference(material.path)).rejects.toThrow('tls.issuerRef.name');
  });

  it('materializes an existing Secret and its required registry issuer through application readers', async (): Promise<void> => {
    const material: MaterializedInstallWizardValues = await materializeInstallWizardValues({
      ingress: { className: 'traefik' },
      platform: { publicProtocol: 'https' },
      registry: { issuerRef: { kind: 'Issuer', name: 'registry-issuer' } },
      storage: { storageClass: 'local-path' },
      tls: { existingSecret: 'platform-tls' },
    });
    temporaryDirectories.push(material.directory);

    await expect(usesOperatorOwnedKubernetesTlsSecret(material.path)).resolves.toBe(true);
    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        publicProtocol: 'https',
        valuesPath: material.path,
      }),
    ).resolves.toMatchObject({
      registryIssuerRef: { kind: 'Issuer', name: 'registry-issuer' },
    });
  });

  it('identifies the values filename and YAML parser detail', async (): Promise<void> => {
    const valuesPath: string = await writeValues('ingress: [\n');

    const error: Error = await readFailure(readOperatorInstallInputValues(valuesPath, true));

    expect(error.message).toContain(`Failed to parse operator values file "${valuesPath}"`);
    expect(error.message).toContain('Flow sequence');
  });
});

async function writeValues(contents: string): Promise<string> {
  const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-operator-values-'));
  temporaryDirectories.push(directory);
  const valuesPath: string = resolve(directory, 'values.yaml');
  await writeFile(valuesPath, contents, 'utf8');
  return valuesPath;
}

async function readFailure(promise: Promise<OperatorInstallInputValues>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error('Expected operator values validation to fail.');
  }
  throw new Error('Expected operator values validation to fail.');
}
