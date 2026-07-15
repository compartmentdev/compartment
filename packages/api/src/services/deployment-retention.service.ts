import type { DeploymentArtifactCleanupTarget, RollbackRetentionEffectivePolicy } from '@compartment/contracts';
import { findJoinedDeploymentById, listJoinedDeploymentsByProjectService } from '../queries/deployment-joined.query';
import { markBuildArtifactsCleaned } from '../queries/deployments.query';
import type { BuildArtifactRow, DeploymentJoinedRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { hasReusableDeploymentImage } from './deployment-reusable-image-state.service';
import { readOrganizationRollbackRetentionSettings } from './organization-settings.service';
import { cleanupDeploymentSourceArchive } from './source-archive-cleanup.service';

const rollbackRetentionOperationTypes: ReadonlySet<string> = new Set([
  'deployment.create',
  'deployment.run',
  'deployment.promote',
  'deployment.rollback',
]);

export async function planRollbackRetentionCleanup(deploymentId: string): Promise<DeploymentArtifactCleanupTarget[]> {
  const deployment: DeploymentJoinedRow | undefined = await findJoinedDeploymentById(
    deploymentId,
    getApiConfig().baseDomain,
  );
  if (deployment === undefined || !rollbackRetentionOperationTypes.has(deployment.operation.type)) {
    return [];
  }
  const policy: RollbackRetentionEffectivePolicy = (
    await readOrganizationRollbackRetentionSettings(deployment.project.organizationId)
  ).effective;
  if (policy.mode === 'indefinite') {
    return [];
  }
  if (policy.limit === null) {
    throw new Error('Expected rollback retention limit for keep_last policy.');
  }
  return await cleanExpiredArtifacts(
    await listJoinedDeploymentsByProjectService(deployment.service.id, getApiConfig().baseDomain),
    policy.limit,
  );
}

async function cleanExpiredArtifacts(
  deployments: DeploymentJoinedRow[],
  limit: number,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const protectedArtifactIds: Set<string> = collectProtectedArtifactIds(deployments, limit);
  const candidates: BuildArtifactRow[] = collectCleanupCandidates(deployments, protectedArtifactIds);
  if (candidates.length === 0) {
    return [];
  }
  const now: Date = new Date();
  const cleaned: BuildArtifactRow[] = await markBuildArtifactsCleaned({
    artifactIds: candidates.map((artifact: BuildArtifactRow): string => artifact.id),
    cleanedAt: now,
    updatedAt: now,
  });
  await cleanupSourceArchivesSafely(cleaned);
  return cleaned.map(toCleanupTarget);
}

function collectProtectedArtifactIds(deployments: DeploymentJoinedRow[], limit: number): Set<string> {
  const protectedIds: Set<string> = new Set<string>();
  const byEnvironment: Map<string, DeploymentJoinedRow[]> = new Map<string, DeploymentJoinedRow[]>();
  for (const deployment of deployments) {
    if (deployment.deployment.status === 'queued' || deployment.deployment.status === 'running') {
      protectedIds.add(deployment.artifact.id);
    }
    const rows: DeploymentJoinedRow[] = byEnvironment.get(deployment.environment.id) ?? [];
    rows.push(deployment);
    byEnvironment.set(deployment.environment.id, rows);
  }
  for (const rows of byEnvironment.values()) {
    for (const deployment of rows.filter(isRetentionCandidate).sort(byCreatedAtDescending).slice(0, limit)) {
      protectedIds.add(deployment.artifact.id);
    }
  }
  return protectedIds;
}

function collectCleanupCandidates(
  deployments: DeploymentJoinedRow[],
  protectedArtifactIds: Set<string>,
): BuildArtifactRow[] {
  const candidates: Map<string, BuildArtifactRow> = new Map<string, BuildArtifactRow>();
  for (const deployment of deployments) {
    if (isRetentionCandidate(deployment) && !protectedArtifactIds.has(deployment.artifact.id)) {
      candidates.set(deployment.artifact.id, deployment.artifact);
    }
  }
  return [...candidates.values()];
}

function isRetentionCandidate(deployment: DeploymentJoinedRow): boolean {
  return (
    hasReusableDeploymentImage(deployment) &&
    (deployment.deployment.status === 'succeeded' || deployment.deployment.status === 'stopped')
  );
}

function byCreatedAtDescending(left: DeploymentJoinedRow, right: DeploymentJoinedRow): number {
  return right.deployment.createdAt.getTime() - left.deployment.createdAt.getTime();
}

async function cleanupSourceArchivesSafely(artifacts: BuildArtifactRow[]): Promise<void> {
  for (const artifact of artifacts) {
    try {
      await cleanupDeploymentSourceArchive(artifact);
    } catch (error) {
      console.warn(
        { artifactId: artifact.id, error: error instanceof Error ? error.message : 'Unknown source cleanup failure.' },
        'Failed to clean retained deployment source archive.',
      );
    }
  }
}

function toCleanupTarget(artifact: BuildArtifactRow): DeploymentArtifactCleanupTarget {
  if (artifact.imageRef === null) {
    throw new Error(`Expected cleanup artifact ${artifact.id} to have an image ref.`);
  }
  return { artifactId: artifact.id, imageRef: artifact.imageRef };
}
