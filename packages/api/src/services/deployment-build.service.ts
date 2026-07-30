import {
  resolvedCompartmentServiceBuildConfigSchema,
  type ResolvedCompartmentServiceBuildConfig,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type { BuildEnvSnapshot, BuildEnvSnapshotValue } from './deployment-build.types';

interface ParsedResolvedBuildEnvSnapshotValuePayload {
  encryptionKeyId?: JsonValue | undefined;
  valueCiphertext?: JsonValue | undefined;
}

type ParsedResolvedBuildEnvPayload = Record<string, JsonValue>;

export function serializeResolvedBuild(build: ResolvedCompartmentServiceBuildConfig): string {
  return JSON.stringify(build);
}

export function parseResolvedBuild(serializedBuild: string): ResolvedCompartmentServiceBuildConfig {
  return resolvedCompartmentServiceBuildConfigSchema.parse(JSON.parse(serializedBuild));
}

export function serializeResolvedBuildEnv(buildEnvSnapshot: BuildEnvSnapshot): string {
  return JSON.stringify(buildEnvSnapshot);
}

export function parseResolvedBuildEnv(serializedBuildEnv: string): BuildEnvSnapshot {
  const parsedBuildEnv: JsonValue = JSON.parse(serializedBuildEnv) as JsonValue;
  if (typeof parsedBuildEnv !== 'object' || parsedBuildEnv === null || Array.isArray(parsedBuildEnv)) {
    throw new Error('Stored build env must be an object.');
  }

  const parsedBuildEnvObject: ParsedResolvedBuildEnvPayload = parsedBuildEnv;
  const buildEnvSnapshot: BuildEnvSnapshot = {};

  for (const [keyName, value] of Object.entries(parsedBuildEnvObject)) {
    buildEnvSnapshot[keyName] = parseResolvedBuildEnvSnapshotValue(keyName, value);
  }

  return buildEnvSnapshot;
}

function parseResolvedBuildEnvSnapshotValue(keyName: string, value: JsonValue): BuildEnvSnapshotValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Stored build env value for "${keyName}" must be an object.`);
  }

  const parsedSnapshotValue: ParsedResolvedBuildEnvSnapshotValuePayload = value;
  if (typeof parsedSnapshotValue.encryptionKeyId !== 'string') {
    throw new Error(`Stored build env encryption key id for "${keyName}" must be a string.`);
  }
  if (typeof parsedSnapshotValue.valueCiphertext !== 'string') {
    throw new Error(`Stored build env ciphertext for "${keyName}" must be a string.`);
  }

  return {
    encryptionKeyId: parsedSnapshotValue.encryptionKeyId,
    valueCiphertext: parsedSnapshotValue.valueCiphertext,
  };
}
