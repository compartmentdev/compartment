import type { DeploymentReusableImageState } from '@compartment/contracts';
import {
  hasReusableDeploymentImage,
  readDeploymentReusableImageState,
} from './deployment-reusable-image-state.service';
import {
  createDeploymentImageCleanedError,
  createDeploymentImageNotAvailableError,
  createRollbackRunTopologyMismatchError,
  createRollbackTargetNotFoundError,
} from '../errors/api-business-error';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import type { ResolvedEnvironmentContext } from './deployments.service.types';
import { requireEnvironmentScopedDeployment } from './deployment-context.service';

export function requirePreviousRollbackCandidate(
  activeDeployment: DeploymentJoinedRow,
  deployments: DeploymentJoinedRow[],
): DeploymentJoinedRow {
  const rollbackTarget: DeploymentJoinedRow | undefined = deployments.find(
    (deployment: DeploymentJoinedRow): boolean =>
      deployment.deployment.id !== activeDeployment.deployment.id &&
      deployment.deployment.status === 'succeeded' &&
      hasReusableDeploymentImage(deployment),
  );
  if (rollbackTarget === undefined) {
    throw createRollbackTargetNotFoundError();
  }

  return rollbackTarget;
}

export function requireRollbackCandidate(deployment: DeploymentJoinedRow): DeploymentJoinedRow {
  if (deployment.deployment.isActive || deployment.deployment.status !== 'succeeded') {
    throw createRollbackTargetNotFoundError();
  }

  return requireReusableArtifactDeployment(deployment);
}

export function requireReusableArtifactDeployment(deployment: DeploymentJoinedRow): DeploymentJoinedRow {
  const reusableImageState: DeploymentReusableImageState = readDeploymentReusableImageState(deployment.artifact);
  if (reusableImageState === 'missing') {
    throw createDeploymentImageNotAvailableError();
  }
  if (reusableImageState === 'cleaned') {
    throw createDeploymentImageCleanedError();
  }

  return deployment;
}

export function requireRollbackScopedDeployment(
  deployment: DeploymentJoinedRow | undefined,
  context: ResolvedEnvironmentContext,
  serviceName: string | undefined,
): DeploymentJoinedRow {
  const scopedDeployment: DeploymentJoinedRow = requireEnvironmentScopedDeployment(deployment, context, serviceName);
  if (scopedDeployment.deployment.isActive) {
    throw createRollbackTargetNotFoundError();
  }

  return scopedDeployment;
}

export function requireRollbackScopedRunDeployments(
  deployments: readonly DeploymentJoinedRow[],
  context: ResolvedEnvironmentContext,
): DeploymentJoinedRow[] {
  const firstDeployment: DeploymentJoinedRow = requireEnvironmentScopedDeployment(deployments[0], context);
  const scopedDeployments: DeploymentJoinedRow[] = [firstDeployment];

  for (const deployment of deployments.slice(1)) {
    scopedDeployments.push(requireEnvironmentScopedDeployment(deployment, context));
  }

  return scopedDeployments;
}

export function requireRollbackRunActiveServiceCoverage(
  targetRunDeployments: readonly DeploymentJoinedRow[],
  activeDeployments: readonly DeploymentJoinedRow[],
): void {
  const targetServiceIds: Set<string> = new Set<string>(
    targetRunDeployments.map((deployment: DeploymentJoinedRow): string => deployment.service.id),
  );

  for (const activeDeployment of activeDeployments) {
    if (!targetServiceIds.has(activeDeployment.service.id)) {
      throw createRollbackRunTopologyMismatchError();
    }
  }
}
