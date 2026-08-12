import { rm } from 'node:fs/promises';
import { buildPrivateRegistryHost } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { readKubernetesChartValues } from './kubernetes-chart-values.service';
import { createKubernetesInstallMaterializedDirectory } from './kubernetes-install-helm.service';
import { prepareKubernetesInstallHelmMaterial } from './kubernetes-install-material.service';
import {
  applyKubernetesConfiguredIngressState,
  resolveInstallPublicIngress,
} from './kubernetes-install-state-ingress.service';
import { buildResolvedInstallValues } from './kubernetes-install-state.service';
import { readRegistryServiceAddresses } from './kubernetes-install-registry-service.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallHelmMaterial,
  KubernetesInstallState,
  KubernetesPublicIngress,
} from './kubernetes-install.service.types';
import type { KubernetesInstallValuesReconciliation } from './kubernetes-install-values-reconciliation.service.types';
import { readYamlFile, type YamlFileObject, type YamlFileValue } from './yaml-file';

export async function inspectKubernetesInstallResumeValues(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall | null,
  effectiveInstall: ExistingKubernetesInstall | null,
  releaseValues: JsonValue | null,
): Promise<KubernetesInstallValuesReconciliation | null> {
  if (existingInstall?.stage !== 'full' || effectiveInstall === null || releaseValues === null) {
    return null;
  }
  return await inspectKubernetesInstallValuesReconciliation(input, effectiveInstall, releaseValues);
}

async function inspectKubernetesInstallValuesReconciliation(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
  releaseValues: JsonValue,
): Promise<KubernetesInstallValuesReconciliation> {
  const desiredValues: JsonValue = await buildDesiredEffectiveValues(input, existingInstall);
  const changedPaths: string[] = listChangedLeafPaths(desiredValues, releaseValues);
  return { changedPaths, required: changedPaths.length !== 0 };
}

export function reportKubernetesInstallValuesReconciliation(
  input: KubernetesInstallDeploymentInput,
  reconciliation: KubernetesInstallValuesReconciliation | null,
): void {
  if (reconciliation?.required === true) {
    input.progress?.report(`Reconciling changed Helm values: ${reconciliation.changedPaths.join(', ')}`, {
      renderMode: 'line',
    });
  }
}

async function buildDesiredEffectiveValues(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): Promise<JsonValue> {
  const directory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    const material: KubernetesInstallHelmMaterial = await prepareKubernetesInstallHelmMaterial(input, directory);
    const desiredState: KubernetesInstallState = await buildDesiredResumeState(input, existingInstall);
    const installValues: JsonValue = toJsonValue(
      buildResolvedInstallValues(desiredState, requireInstallToken(existingInstall)),
    );
    const values: JsonValue[] = await Promise.all([
      readKubernetesChartValues(material.chartPath),
      readYamlFile(material.platformImageValuesPath, 'platform image values file'),
      readYamlFile(input.valuesPath, 'operator values file'),
      Promise.resolve(installValues),
      readYamlFile(material.imageTrustValuesPath, 'image trust values file'),
      Promise.resolve({ platform: { startupStage: 'full' } }),
    ]);
    const [chartValues, ...overlays]: YamlFileObject[] = values.map(requireValuesObject);
    return overlays.reduce(mergeKubernetesHelmValues, chartValues!);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildDesiredResumeState(
  input: KubernetesInstallDeploymentInput,
  existingInstall: ExistingKubernetesInstall,
): Promise<KubernetesInstallState> {
  const registryHostname: string = buildPrivateRegistryHost((await readRegistryServiceAddresses(input))[0]!);
  const state: KubernetesInstallState = applyKubernetesConfiguredIngressState(input, {
    ...existingInstall,
    acmeEmail: input.acmeEmail,
    ingressClassName: input.ingressClassName,
    registryHostname,
    registryIssuerRef:
      input.registryIssuerRef.name === '' ? existingInstall.registryIssuerRef : input.registryIssuerRef,
  });
  if (!input.clearConfiguredIngressEndpoint) {
    return state;
  }
  const publicIngress: KubernetesPublicIngress = await resolveInstallPublicIngress(input, state);
  return { ...state, ...publicIngress };
}

function requireInstallToken(existingInstall: ExistingKubernetesInstall): string {
  if (existingInstall.installToken === null) {
    throw new Error('Cannot reconcile a full Helm release without its retained install token.');
  }
  return existingInstall.installToken;
}

function requireValuesObject(value: YamlFileValue): YamlFileObject {
  if (isValuesObject(value)) {
    return value;
  }
  throw new Error('The operator values file must contain a YAML object.');
}

export function mergeKubernetesHelmValues(base: JsonValue, overlay: JsonValue): JsonValue {
  let merged: JsonValue = overlay;
  if (isValuesObject(base) && isValuesObject(overlay)) {
    const mergedObject: Record<string, JsonValue> = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      if (value === null) {
        Reflect.deleteProperty(mergedObject, key);
      } else {
        mergedObject[key] = key in mergedObject ? mergeKubernetesHelmValues(mergedObject[key]!, value) : value;
      }
    }
    merged = mergedObject;
  }
  return merged;
}

function listChangedLeafPaths(
  desired: JsonValue | undefined,
  actual: JsonValue | undefined,
  path: readonly string[] = [],
): string[] {
  if (isValuesObject(desired) || isValuesObject(actual)) {
    const keys: string[] = [...new Set([...readObjectKeys(desired), ...readObjectKeys(actual)])].sort(
      (left: string, right: string): number => left.localeCompare(right),
    );
    return keys.flatMap((key: string): string[] =>
      listChangedLeafPaths(readObjectValue(desired, key), readObjectValue(actual, key), [...path, key]),
    );
  }
  if (valuesEqual(desired, actual)) {
    return [];
  }
  return [formatValuesPath(path)];
}

function readObjectValue(value: JsonValue | undefined, key: string): JsonValue | undefined {
  return isValuesObject(value) && key in value ? value[key] : undefined;
}

function readObjectKeys(value: JsonValue | undefined): string[] {
  return isValuesObject(value) ? Object.keys(value) : [];
}

function valuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatValuesPath(path: readonly string[]): string {
  return path.length === 0 ? '(root)' : path.join('.');
}

function toJsonValue(value: object): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function isValuesObject(value: JsonValue | YamlFileValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
