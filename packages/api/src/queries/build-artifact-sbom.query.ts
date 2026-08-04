import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { buildArtifacts } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { StoreBuildArtifactSbomInput } from './build-artifact-sbom.query.types';

export async function storeBuildArtifactSbom(input: StoreBuildArtifactSbomInput): Promise<boolean> {
  const [artifact] = await getApiDatabase()
    .update(buildArtifacts)
    .set(buildArtifactSbomValues(input))
    .where(buildArtifactSbomWriteFilter(input))
    .returning({ id: buildArtifacts.id });
  return artifact !== undefined;
}

function buildArtifactSbomWriteFilter(input: StoreBuildArtifactSbomInput): SQL | undefined {
  const emptySbom: SQL | undefined = and(
    isNull(buildArtifacts.sbomDigest),
    isNull(buildArtifacts.sbomImageDigest),
    isNull(buildArtifacts.sbomJson),
  );
  const exactSbom: SQL | undefined = and(
    eq(buildArtifacts.sbomDigest, input.digest),
    eq(buildArtifacts.sbomImageDigest, input.imageDigest),
    eq(buildArtifacts.sbomJson, input.sbomJson),
  );
  return and(
    eq(buildArtifacts.id, input.artifactId),
    eq(buildArtifacts.buildState, 'building'),
    eq(buildArtifacts.buildOwnerDeploymentId, input.deploymentId),
    or(emptySbom, exactSbom),
  );
}

function buildArtifactSbomValues(input: StoreBuildArtifactSbomInput): {
  sbomDigest: string;
  sbomImageDigest: string;
  sbomJson: string;
  updatedAt: Date;
} {
  return {
    sbomDigest: input.digest,
    sbomImageDigest: input.imageDigest,
    sbomJson: input.sbomJson,
    updatedAt: new Date(),
  };
}
