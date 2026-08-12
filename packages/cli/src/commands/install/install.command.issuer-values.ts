import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DomainIssuerReference } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import {
  createKubernetesInstallMaterializedDirectory,
  writeKubernetesInstallValues,
} from '../../services/kubernetes-install-helm.service';
import { mergeKubernetesHelmValues } from '../../services/kubernetes-install-values-reconciliation.service';
import { validateKubernetesResourceName } from '../../services/kubernetes-resource-name';
import { readYamlFile, type YamlFileObject, type YamlFileValue } from '../../services/yaml-file';
import type { MaterializedInstallWizardValues } from './install.command.values';

interface InstallIssuerOverrides {
  registryIssuer?: string | undefined;
  ingressClass?: string | undefined;
  storageClass?: string | undefined;
  tlsIssuer?: string | undefined;
  valuesPath?: string | undefined;
}

export async function materializeInstallIssuerOverrides(
  input: InstallIssuerOverrides,
): Promise<MaterializedInstallWizardValues | undefined> {
  if (input.tlsIssuer === undefined && input.registryIssuer === undefined) {
    return undefined;
  }
  const source: JsonValue = await readSourceValues(input.valuesPath);
  const overlay: JsonValue = buildIssuerOverlay(input);
  return await writeMergedValues(mergeKubernetesHelmValues(source, overlay));
}

export async function cleanMaterializedInstallValues(
  material: MaterializedInstallWizardValues | undefined,
): Promise<void> {
  if (material !== undefined) {
    await rm(material.directory, { force: true, recursive: true });
  }
}

async function readSourceValues(valuesPath: string | undefined): Promise<JsonValue> {
  const source: YamlFileValue = valuesPath === undefined ? {} : await readYamlFile(valuesPath, 'operator values file');
  if (!isValuesObject(source)) {
    throw new Error('The operator values file must contain a YAML object.');
  }
  return source;
}

function buildIssuerOverlay(input: InstallIssuerOverrides): JsonValue {
  const registryIssuer: DomainIssuerReference | undefined = parseOptionalIssuerReference(
    input.registryIssuer,
    '--registry-issuer',
  );
  const tlsIssuer: DomainIssuerReference | undefined = parseOptionalIssuerReference(input.tlsIssuer, '--tls-issuer');
  return {
    ...(registryIssuer === undefined
      ? {}
      : { registry: { issuerRef: { kind: registryIssuer.kind, name: registryIssuer.name } } }),
    ...(input.ingressClass === undefined ? {} : { ingress: { className: input.ingressClass } }),
    ...(input.storageClass === undefined ? {} : { storage: { storageClass: input.storageClass } }),
    ...(tlsIssuer === undefined ? {} : { tls: { issuerRef: { kind: tlsIssuer.kind, name: tlsIssuer.name } } }),
  };
}

function parseOptionalIssuerReference(value: string | undefined, field: string): DomainIssuerReference | undefined {
  return value === undefined ? undefined : parseIssuerReference(value, field);
}

function parseIssuerReference(value: string, field: string): DomainIssuerReference {
  const parts: string[] = value.split('/');
  const kind: string | undefined = parts[0];
  const name: string | undefined = parts[1];
  const nameError: string | undefined =
    name === undefined ? 'is required' : validateKubernetesResourceName(name, field);
  if (
    (kind !== 'Issuer' && kind !== 'ClusterIssuer') ||
    name === undefined ||
    parts.length !== 2 ||
    nameError !== undefined
  ) {
    throw new Error(`${field} must use Issuer/name or ClusterIssuer/name with a valid Kubernetes resource name.`);
  }
  return { kind, name };
}

async function writeMergedValues(values: JsonValue): Promise<MaterializedInstallWizardValues> {
  if (!isValuesObject(values)) {
    throw new Error('Merged operator values must contain an object.');
  }
  const directory: string = await createKubernetesInstallMaterializedDirectory();
  const path: string = join(directory, 'values.json');
  await writeKubernetesInstallValues(path, values);
  return { directory, path };
}

function isValuesObject(value: JsonValue | YamlFileValue): value is YamlFileObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
