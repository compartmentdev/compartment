import type { RollbackRetentionEffectivePolicy } from '@compartment/contracts';
import { listJoinedDeploymentsByProjectService } from '../queries/deployment-joined.query';
import { markBuildArtifactsCleaned } from '../queries/deployments.query';
import type { BuildArtifactRow, DeploymentJoinedRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { hasReusableDeploymentImage } from './deployment-reusable-image-state.service';
import { readOrganizationRollbackRetentionSettings } from './organization-settings.service';
import { cleanupDeploymentSourceArchive } from './source-archive-cleanup.service';
import type { DeploymentArtifactCleanupTarget } from './deployment-retention.service.types';

const rollbackRetentionOperationTypes: ReadonlySet<string> = new Set([
  'deployment.create',
  'deployment.run',
  'deployment.promote',
  'deployment.rollback',
]);

export async function planRollbackRetentionCleanup(
  deployment: DeploymentJoinedRow,
): Promise<DeploymentArtifactCleanupTarget[]> {
  if (!rollbackRetentionOperationTypes.has(deployment.operation.type)) {
    return [];
  }
  const limit: number | null = await readRollbackRetentionLimit(deployment.project.organizationId);
  if (limit === null) {
    return [];
  }

  const deployments: DeploymentJoinedRow[] = await listRetentionScopeDeployments(deployment.service.id);
  return await cleanupRetainedArtifacts(deployments, limit);
}

async function readRollbackRetentionLimit(organizationId: string): Promise<number | null> {
  const policy: RollbackRetentionEffectivePolicy = (await readOrganizationRollbackRetentionSettings(organizationId))
    .effective;
  if (policy.mode === 'indefinite') {
    return null;
  }

  return requireRollbackRetentionLimit(policy.limit);
}

async function listRetentionScopeDeployments(projectServiceId: string): Promise<DeploymentJoinedRow[]> {
  return await listJoinedDeploymentsByProjectService(projectServiceId, getApiConfig().baseDomain);
}

async function cleanupRetainedArtifacts(
  deployments: DeploymentJoinedRow[],
  limit: number,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const protectedArtifactIds: Set<string> = buildProtectedArtifactIds(deployments, limit);
  const cleanupCandidates: DeploymentArtifactCleanupTarget[] = collectCleanupCandidates(
    deployments,
    protectedArtifactIds,
  );
  if (cleanupCandidates.length === 0) {
    return [];
  }

  const now: Date = new Date();
  const cleanedArtifacts: BuildArtifactRow[] = await markBuildArtifactsCleaned({
    artifactIds: cleanupCandidates.map((candidate: DeploymentArtifactCleanupTarget): string => candidate.artifactId),
    cleanedAt: now,
    updatedAt: now,
  });
  await cleanupCleanedArtifactSourceArchives(cleanedArtifacts);

  return cleanedArtifacts.map(toDeploymentArtifactCleanupTarget);
}

async function cleanupCleanedArtifactSourceArchives(cleanedArtifacts: BuildArtifactRow[]): Promise<void> {
  for (const artifact of cleanedArtifacts) {
    await cleanupDeploymentSourceArchive(artifact);
  }
}

function buildProtectedArtifactIds(deployments: DeploymentJoinedRow[], limit: number): Set<string> {
  const protectedArtifactIds: Set<string> = collectInFlightArtifactIds(deployments);
  protectRetainedEnvironmentArtifacts(groupDeploymentsByEnvironment(deployments), limit, protectedArtifactIds);
  return protectedArtifactIds;
}

function collectInFlightArtifactIds(deployments: DeploymentJoinedRow[]): Set<string> {
  const protectedArtifactIds: Set<string> = new Set<string>();

  for (const deployment of deployments) {
    if (isInFlightDeployment(deployment)) {
      protectedArtifactIds.add(deployment.artifact.id);
    }
  }

  return protectedArtifactIds;
}

function groupDeploymentsByEnvironment(deployments: DeploymentJoinedRow[]): Map<string, DeploymentJoinedRow[]> {
  const deploymentsByEnvironment: Map<string, DeploymentJoinedRow[]> = new Map<string, DeploymentJoinedRow[]>();

  for (const deployment of deployments) {
    const environmentDeployments: DeploymentJoinedRow[] = deploymentsByEnvironment.get(deployment.environment.id) ?? [];
    environmentDeployments.push(deployment);
    deploymentsByEnvironment.set(deployment.environment.id, environmentDeployments);
  }

  return deploymentsByEnvironment;
}

function protectRetainedEnvironmentArtifacts(
  deploymentsByEnvironment: Map<string, DeploymentJoinedRow[]>,
  limit: number,
  protectedArtifactIds: Set<string>,
): void {
  for (const environmentDeployments of deploymentsByEnvironment.values()) {
    const retainedDeployments: DeploymentJoinedRow[] = environmentDeployments
      .filter(isRollbackRetentionCandidate)
      .sort(compareDeploymentsByCreatedAtDesc)
      .slice(0, limit);

    for (const deployment of retainedDeployments) {
      protectedArtifactIds.add(deployment.artifact.id);
    }
  }
}

function collectCleanupCandidates(
  deployments: DeploymentJoinedRow[],
  protectedArtifactIds: Set<string>,
): DeploymentArtifactCleanupTarget[] {
  const cleanupCandidates: Map<string, DeploymentArtifactCleanupTarget> = new Map<
    string,
    DeploymentArtifactCleanupTarget
  >();

  for (const deployment of deployments) {
    if (!isRollbackRetentionCandidate(deployment) || protectedArtifactIds.has(deployment.artifact.id)) {
      continue;
    }

    cleanupCandidates.set(deployment.artifact.id, toDeploymentArtifactCleanupTarget(deployment.artifact));
  }

  return [...cleanupCandidates.values()];
}

function toDeploymentArtifactCleanupTarget(
  artifact: Pick<BuildArtifactRow, 'id' | 'imageRef'>,
): DeploymentArtifactCleanupTarget {
  const imageRef: string | null = artifact.imageRef;
  if (imageRef === null) {
    throw new Error(`Expected cleanup artifact ${artifact.id} to have an image ref.`);
  }

  return {
    artifactId: artifact.id,
    imageRef,
  };
}

function isRollbackRetentionCandidate(deployment: DeploymentJoinedRow): boolean {
  return (
    hasReusableDeploymentImage(deployment) &&
    (deployment.deployment.status === 'succeeded' || deployment.deployment.status === 'stopped')
  );
}

function isInFlightDeployment(deployment: DeploymentJoinedRow): boolean {
  return deployment.deployment.status === 'queued' || deployment.deployment.status === 'running';
}

function compareDeploymentsByCreatedAtDesc(left: DeploymentJoinedRow, right: DeploymentJoinedRow): number {
  return right.deployment.createdAt.getTime() - left.deployment.createdAt.getTime();
}

function requireRollbackRetentionLimit(limit: number | null): number {
  if (limit === null) {
    throw new Error('Expected rollback retention limit for keep_last policy.');
  }

  return limit;
}
