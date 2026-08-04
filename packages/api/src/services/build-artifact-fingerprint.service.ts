import { createHash, createHmac } from 'node:crypto';
import type { ResolvedCompartmentServiceBuildConfig } from '@compartment/contracts';
import { decryptTenantVariableValueFromStorage } from '../lib/variables-crypto';
import { getApiConfig } from '../runtime/runtime-access';
import type { ApiConfig } from '../config';
import type { BuildArtifactFingerprintInput } from './build-artifact-fingerprint.service.types';
import type { BuildEnvSnapshotValue } from './deployment-build.types';

const artifactFingerprintVersion: string = 'compartment-artifact:v1';
const builderPlatform: string = 'linux/amd64';

interface BuildArtifactFingerprintPayload {
  build: ResolvedCompartmentServiceBuildConfig;
  buildValueFingerprints: Record<string, string>;
  builderProfileDigest: string;
  organizationId: string;
  platform: string;
  projectId: string;
  projectServiceId: string;
  sourceDigest: string;
  version: string;
}

export function buildArtifactFingerprint(input: BuildArtifactFingerprintInput): string {
  const config: ApiConfig = getApiConfig();
  const buildValueFingerprints: Record<string, string> = Object.fromEntries(
    Object.entries(input.buildEnvSnapshot)
      .sort((left: [string, BuildEnvSnapshotValue], right: [string, BuildEnvSnapshotValue]): number =>
        left[0].localeCompare(right[0]),
      )
      .map(([keyName, value]: [string, BuildEnvSnapshotValue]): [string, string] => [
        keyName,
        fingerprintBuildValue(input.organizationId, keyName, value),
      ]),
  );
  const payload: BuildArtifactFingerprintPayload = {
    build: input.build,
    buildValueFingerprints,
    builderProfileDigest: config.builderProfileDigest,
    organizationId: input.organizationId,
    platform: builderPlatform,
    projectId: input.projectId,
    projectServiceId: input.projectServiceId,
    sourceDigest: input.sourceDigest,
    version: artifactFingerprintVersion,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function fingerprintBuildValue(organizationId: string, keyName: string, snapshot: BuildEnvSnapshotValue): string {
  const config: ApiConfig = getApiConfig();
  const plaintext: string = decryptTenantVariableValueFromStorage(
    snapshot.valueCiphertext,
    snapshot.encryptionKeyId,
    config.tenantSecretsKek,
    config.tenantSecretsPreviousKek,
  );
  return createHmac('sha256', config.variablesMasterKey)
    .update(artifactFingerprintVersion)
    .update('\0')
    .update(organizationId)
    .update('\0')
    .update(keyName)
    .update('\0')
    .update(plaintext)
    .digest('base64url');
}
