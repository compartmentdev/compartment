import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyObject } from '../src/kube-runtime-operations';
import type { ApplyBundle, KubeManifest } from '../src/kube-runtime.types';
import { CapturingKubernetesObjectApi } from './kube-transport-capture.harness';
import type {
  KubeRuntimeModuleExports,
  WireDifference,
  WireObject,
  WireValue,
} from './kube-transport-audit.test.types';

/**
 * `@kubernetes/client-node` renames generated model properties that collide with TypeScript keywords, and
 * `ObjectSerializer` reads the model name while it writes the wire name. A projection therefore has to build the
 * model name, and the audit treats these two spellings as the same field. Every other underscore-prefixed key is a
 * name no model declares, which the serializer drops from the request body without raising anything.
 */
const modelPropertyAliases: ReadonlyMap<string, string> = new Map<string, string>([
  ['_default', 'default'],
  ['_from', 'from'],
]);

const sourceDirectory: string = resolve(__dirname, '..', 'src');

export async function serializeManifestOnTheWire(manifest: KubeManifest): Promise<WireObject> {
  const objectApi: CapturingKubernetesObjectApi = new CapturingKubernetesObjectApi(auditUriPath(manifest));
  await applyObject(objectApi, manifest, false);
  return JSON.parse(objectApi.body ?? '{}') as WireObject;
}

/** Reports every field the projection built that the API server would not receive, and every wire-only surprise. */
export function auditManifestOnTheWire(manifest: KubeManifest, serialized: WireObject): WireDifference[] {
  const projected: WireObject = JSON.parse(JSON.stringify(manifest)) as WireObject;
  const differences: WireDifference[] = [];
  compareObjects(projected, serialized, '', differences);
  return differences;
}

export function describeDifference(projection: string, manifest: KubeManifest, difference: WireDifference): string {
  return [
    `${projection} -> ${describeManifest(manifest)}${difference.path}`,
    `projected ${difference.projected}, API server receives ${difference.serialized}`,
  ].join(': ');
}

export function bundleManifests(bundle: ApplyBundle): KubeManifest[] {
  return [...(bundle.createBeforeApply ?? []), ...bundle.objects, ...(bundle.deleteAfterApply ?? [])];
}

/**
 * Reflects over the compiled package surface instead of parsing sources, so a projection added in a brand new module
 * still has to appear in the audit registry.
 */
export async function listManifestProjectionExports(): Promise<string[]> {
  const names: Set<string> = new Set<string>();
  for (const file of readdirSync(sourceDirectory).filter(isProjectionModuleFile)) {
    const loaded: KubeRuntimeModuleExports = await importSourceModule(file);
    for (const [name, member] of Object.entries(loaded)) {
      if (typeof member === 'function' && isManifestProjectionName(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort((left: string, right: string): number => left.localeCompare(right));
}

async function importSourceModule(file: string): Promise<KubeRuntimeModuleExports> {
  const specifier: string = pathToFileURL(join(sourceDirectory, file)).href;
  return (await import(/* @vite-ignore */ specifier)) as KubeRuntimeModuleExports;
}

function describeManifest(manifest: KubeManifest): string {
  return `${manifest.kind} ${manifest.metadata?.name ?? '<unnamed>'}`;
}

function isProjectionModuleFile(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.types.ts');
}

function isManifestProjectionName(name: string): boolean {
  return /^project[A-Z]/.test(name) || /Manifests?$/.test(name);
}

function auditUriPath(manifest: KubeManifest): string {
  const namespace: string = manifest.metadata?.namespace ?? 'default';
  return `/apis/${manifest.apiVersion}/namespaces/${namespace}/${manifest.kind.toLowerCase()}s/${manifest.metadata?.name ?? ''}`;
}

function compareObjects(
  projected: WireObject,
  serialized: WireObject,
  path: string,
  differences: WireDifference[],
): void {
  for (const [key, value] of Object.entries(projected)) {
    if (value === undefined) {
      continue;
    }
    const wireKey: string | null = wirePropertyName(key);
    if (wireKey === null) {
      differences.push(unknownAliasDifference(path, key));
      continue;
    }
    compareValues(value, serialized[wireKey], childPath(path, wireKey), differences);
  }
  for (const key of Object.keys(serialized)) {
    if (!hasProjectedWireKey(projected, key)) {
      differences.push({
        path: childPath(path, key),
        projected: 'nothing',
        serialized: describeValue(serialized[key]),
      });
    }
  }
}

function compareValues(
  projected: WireValue,
  serialized: WireValue | undefined,
  path: string,
  differences: WireDifference[],
): void {
  if (Array.isArray(projected)) {
    compareArrays(projected, serialized, path, differences);
    return;
  }
  if (projected !== null && typeof projected === 'object') {
    if (!isWireObject(serialized)) {
      differences.push({ path, projected: describeValue(projected), serialized: describeValue(serialized) });
      return;
    }
    compareObjects(projected, serialized, path, differences);
    return;
  }
  if (projected !== serialized) {
    differences.push({ path, projected: describeValue(projected), serialized: describeValue(serialized) });
  }
}

function compareArrays(
  projected: WireValue[],
  serialized: WireValue | undefined,
  path: string,
  differences: WireDifference[],
): void {
  if (!Array.isArray(serialized) || serialized.length !== projected.length) {
    differences.push({ path, projected: describeValue(projected), serialized: describeValue(serialized) });
    return;
  }
  projected.forEach((value: WireValue, index: number): void => {
    compareValues(value, serialized[index], `${path}[${index}]`, differences);
  });
}

function unknownAliasDifference(path: string, key: string): WireDifference {
  return {
    path: childPath(path, key),
    projected: 'a property name no client-node model declares',
    serialized: 'nothing, because the serializer drops unknown model properties',
  };
}

function wirePropertyName(key: string): string | null {
  if (!key.startsWith('_')) {
    return key;
  }
  return modelPropertyAliases.get(key) ?? null;
}

function hasProjectedWireKey(projected: WireObject, wireKey: string): boolean {
  return Object.entries(projected).some(
    ([key, value]: [string, WireValue | undefined]): boolean =>
      value !== undefined && wirePropertyName(key) === wireKey,
  );
}

function isWireObject(value: WireValue | undefined): value is WireObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

function childPath(path: string, key: string): string {
  return `${path}.${key}`;
}

function describeValue(value: WireValue | undefined): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}
