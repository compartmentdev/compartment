import { isAbsolute, resolve } from 'node:path';
import type { JsonValue } from '@compartment/utils';
import type { KubernetesKubeconfigDocument } from './kubernetes-install-kubeconfig.service.types';

export function mergeKubeconfigDocuments(
  documents: readonly KubernetesKubeconfigDocument[],
): KubernetesKubeconfigDocument {
  const merged: KubernetesKubeconfigDocument = { apiVersion: 'v1', kind: 'Config' };
  for (const key of ['clusters', 'contexts', 'users'] as const) {
    merged[key] = mergeNamedKubeconfigEntries(documents, key);
  }
  const currentContext: string | undefined = documents
    .map((document: KubernetesKubeconfigDocument): JsonValue | undefined => document['current-context'])
    .find((value: JsonValue | undefined): value is string => typeof value === 'string' && value.trim() !== '');
  if (currentContext !== undefined) {
    merged['current-context'] = currentContext;
  }
  return merged;
}

export function absolutizeKubeconfigFileReferences(
  document: KubernetesKubeconfigDocument,
  sourceDirectory: string,
): KubernetesKubeconfigDocument {
  const clusters: KubernetesKubeconfigDocument = mapNamedKubeconfigEntries(
    document,
    'clusters',
    'cluster',
    ['certificate-authority'],
    sourceDirectory,
  );
  return mapNamedKubeconfigEntries(
    clusters,
    'users',
    'user',
    ['client-certificate', 'client-key', 'tokenFile'],
    sourceDirectory,
  );
}

function mergeNamedKubeconfigEntries(
  documents: readonly KubernetesKubeconfigDocument[],
  key: 'clusters' | 'contexts' | 'users',
): JsonValue[] {
  const entries: JsonValue[] = [];
  const names: Set<string> = new Set<string>();
  for (const document of documents) {
    const candidates: JsonValue | undefined = document[key];
    if (Array.isArray(candidates)) {
      appendNamedEntries(candidates, names, entries);
    }
  }
  return entries;
}

function appendNamedEntries(candidates: JsonValue[], names: Set<string>, entries: JsonValue[]): void {
  for (const candidate of candidates) {
    if (!isObject(candidate) || typeof candidate.name !== 'string' || names.has(candidate.name)) {
      continue;
    }
    names.add(candidate.name);
    entries.push(candidate);
  }
}

function mapNamedKubeconfigEntries(
  document: KubernetesKubeconfigDocument,
  listKey: 'clusters' | 'users',
  valueKey: 'cluster' | 'user',
  pathKeys: readonly string[],
  sourceDirectory: string,
): KubernetesKubeconfigDocument {
  const entries: JsonValue | undefined = document[listKey];
  if (!Array.isArray(entries)) {
    return document;
  }
  return {
    ...document,
    [listKey]: entries.map(
      (entry: JsonValue): JsonValue =>
        isObject(entry) ? absolutizeKubeconfigEntry(entry, valueKey, pathKeys, sourceDirectory) : entry,
    ),
  };
}

function absolutizeKubeconfigEntry(
  entry: KubernetesKubeconfigDocument,
  valueKey: 'cluster' | 'user',
  pathKeys: readonly string[],
  sourceDirectory: string,
): KubernetesKubeconfigDocument {
  const sourceValue: JsonValue | undefined = entry[valueKey];
  if (!isObject(sourceValue)) {
    return entry;
  }
  const value: KubernetesKubeconfigDocument = { ...sourceValue };
  for (const pathKey of pathKeys) {
    const configuredPath: JsonValue | undefined = value[pathKey];
    if (typeof configuredPath === 'string' && configuredPath !== '' && !isAbsolute(configuredPath)) {
      value[pathKey] = resolve(sourceDirectory, configuredPath);
    }
  }
  return { ...entry, [valueKey]: value };
}

function isObject(value: JsonValue | undefined): value is KubernetesKubeconfigDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
