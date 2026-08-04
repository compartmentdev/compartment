import { createHash } from 'node:crypto';
import type { JsonValue } from '@compartment/utils';
import { storeBuildArtifactSbom } from '../queries/build-artifact-sbom.query';

import type { PersistBuildArtifactSbomInput } from './build-artifact-sbom.service.types';

export async function persistBuildArtifactSbom(input: PersistBuildArtifactSbomInput): Promise<boolean> {
  validateSyftDocument(input.sbomJson);
  const actualDigest: string = `sha256:${createHash('sha256').update(input.sbomJson).digest('hex')}`;
  if (actualDigest !== input.digest) {
    throw new InvalidBuildArtifactSbomError('SBOM digest does not match its JSON document.');
  }
  return await storeBuildArtifactSbom(input);
}

export class InvalidBuildArtifactSbomError extends Error {}

function validateSyftDocument(sbomJson: string): void {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(sbomJson) as JsonValue;
  } catch {
    throw new InvalidBuildArtifactSbomError('SBOM must be valid Syft JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || !('artifacts' in parsed) || !Array.isArray(parsed.artifacts)) {
    throw new InvalidBuildArtifactSbomError('SBOM must contain a Syft artifact inventory.');
  }
}
