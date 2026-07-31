import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(error.message).toContain(`${valuesPath}: registry.issuerRef: is required when tls.existingSecret is used`);
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

  it('reports an invalid container and independently missing TLS in the same error', async (): Promise<void> => {
    const valuesPath: string = await writeValues('ingress: traefik\n');

    const error: Error = await readFailure(readOperatorInstallInputValues(valuesPath, true));

    expect(error.message).toContain(`${valuesPath}: ingress: Expected object, received string`);
    expect(error.message).toContain(`${valuesPath}: tls: must define either issuerRef or existingSecret`);
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
tls:
  issuerRef:
    kind: ClusterIssuer
    name: platform-ca
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
tenantRuntime:
  runtimeClassName: gvisor
  createRuntimeClass: true
  runtimeHandler: runsc
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
      storage: { storageClass: 'local-path' },
      tls: { issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-production' } },
    });
    temporaryDirectories.push(material.directory);

    await expect(readOperatorInstallInputValues(material.path, true)).resolves.toEqual({
      clearIngressEndpoint: false,
      ingressClass: 'traefik',
      storageClass: 'local-path',
    });
    await expect(
      resolveKubernetesInstallRegistryConfiguration({
        baseDomain: 'apps.example.com',
        domainMode: 'custom',
        valuesPath: material.path,
      }),
    ).resolves.toMatchObject({
      registryHostname: 'registry.apps.example.com',
      registryIssuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-production' },
    });
    await expect(readKubernetesTlsIssuerReference(material.path)).resolves.toEqual({
      kind: 'ClusterIssuer',
      name: 'letsencrypt-production',
    });
  });

  it('materializes an existing Secret and its required registry issuer through application readers', async (): Promise<void> => {
    const material: MaterializedInstallWizardValues = await materializeInstallWizardValues({
      ingress: { className: 'traefik' },
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
