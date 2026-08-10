import type { KubeManifest } from '../src/kube-runtime.types';

/** Everything a projected manifest can still hold once JSON has erased its TypeScript type. */
export type WireValue = boolean | number | string | null | WireValue[] | WireObject;

export interface WireObject {
  [key: string]: WireValue | undefined;
}

export type TransportAuditManifestFactory = () => KubeManifest[];

export interface TransportAuditCase {
  /** Exported projection name. The coverage check matches these against the package surface. */
  projection: string;
  manifests: TransportAuditManifestFactory;
}

export interface WireDifference {
  path: string;
  projected: string;
  serialized: string;
}

export type ExportedModuleMember = ((...args: never[]) => void) | object | string | number | boolean | null | undefined;

export type KubeRuntimeModuleExports = Record<string, ExportedModuleMember>;
