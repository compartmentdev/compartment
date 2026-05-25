import { createDeploymentTargetBusyError } from '../errors/api-business-error';
import { readDeploymentMovementTargetKey } from '../queries/deployment-movement-target.query';
import type {
  DeploymentMovementTargetSelector,
  PersistedTargetDeploymentRow,
} from '../queries/deployment-movement.query.types';
import { toDeploymentRow } from '../queries/deployments.query';
import type { DeploymentRow } from '../queries/deployments.query.types';
import type {
  ResolvedDeploymentMovementBatchItem,
  SerializedDeploymentMovementBatchItem,
  TargetMovementClassification,
} from './artifact-deployment-movement.service.types';

export function compareSerializedDeploymentMovementTargetLockOrder(
  left: SerializedDeploymentMovementBatchItem,
  right: SerializedDeploymentMovementBatchItem,
): number {
  return readSerializedDeploymentMovementTargetKey(left).localeCompare(
    readSerializedDeploymentMovementTargetKey(right),
  );
}

export function collectSerializedDeploymentMovementTargets(
  items: SerializedDeploymentMovementBatchItem[],
): DeploymentMovementTargetSelector[] {
  const targets: Map<string, DeploymentMovementTargetSelector> = new Map<string, DeploymentMovementTargetSelector>();

  for (const item of items) {
    const target: DeploymentMovementTargetSelector = toMovementTargetSelector(item);

    targets.set(readDeploymentMovementTargetKey(target), target);
  }

  return [...targets.values()];
}

export function readDuplicateSerializedDeploymentMovementBatch(
  items: SerializedDeploymentMovementBatchItem[],
  deploymentsByTarget: Map<string, PersistedTargetDeploymentRow[]>,
): DeploymentRow[] | null {
  const duplicateItems: ResolvedDeploymentMovementBatchItem[] = [];
  let hasInFlightDuplicate: boolean = false;

  for (const item of items) {
    const classification: TargetMovementClassification = classifyTargetMovement(
      deploymentsByTarget.get(readSerializedDeploymentMovementTargetKey(item)) ?? [],
      item,
    );
    if (classification.kind === 'conflict') {
      throw createDeploymentTargetBusyError();
    }
    if (classification.kind === 'duplicate') {
      hasInFlightDuplicate ||= classification.inFlight;
      duplicateItems.push(toResolvedDuplicateMovementItem(classification.deployment, item.requestIndex));
    }
  }

  return buildDuplicateMovementBatchReadResult(duplicateItems, items.length, hasInFlightDuplicate);
}

function buildDuplicateMovementBatchReadResult(
  duplicateItems: ResolvedDeploymentMovementBatchItem[],
  itemCount: number,
  hasInFlightDuplicate: boolean,
): DeploymentRow[] | null {
  if (duplicateItems.length === 0 || !hasInFlightDuplicate) {
    return null;
  }
  if (duplicateItems.length !== itemCount) {
    throw createDeploymentTargetBusyError();
  }

  return sortResolvedDeploymentMovementItemsByRequestIndex(duplicateItems);
}

export function sortResolvedDeploymentMovementItemsByRequestIndex(
  items: ResolvedDeploymentMovementBatchItem[],
): DeploymentRow[] {
  return [...items]
    .sort(
      (left: ResolvedDeploymentMovementBatchItem, right: ResolvedDeploymentMovementBatchItem): number =>
        left.requestIndex - right.requestIndex,
    )
    .map((item: ResolvedDeploymentMovementBatchItem): DeploymentRow => item.deployment);
}

function classifyTargetMovement(
  deploymentsByTarget: PersistedTargetDeploymentRow[],
  item: SerializedDeploymentMovementBatchItem,
): TargetMovementClassification {
  const inFlightDeployments: PersistedTargetDeploymentRow[] = deploymentsByTarget.filter(
    isInFlightMovementTargetDeployment,
  );
  const latestDeployment: PersistedTargetDeploymentRow | undefined = deploymentsByTarget[0];
  if (inFlightDeployments.length === 0) {
    return readHistoricalTargetMovementClassification(latestDeployment, item);
  }

  if (
    !inFlightDeployments.every((deployment: PersistedTargetDeploymentRow): boolean =>
      isExactTargetDeploymentMovementMatch(deployment, item),
    )
  ) {
    return { kind: 'conflict' };
  }
  if (latestDeployment !== undefined && !isExactTargetDeploymentMovementMatch(latestDeployment, item)) {
    return { kind: 'conflict' };
  }

  return buildDuplicateTargetMovementClassification(inFlightDeployments[0]!, true);
}

function readHistoricalTargetMovementClassification(
  latestDeployment: PersistedTargetDeploymentRow | undefined,
  item: SerializedDeploymentMovementBatchItem,
): TargetMovementClassification {
  if (!isReusableHistoricalTargetMovementMatch(latestDeployment, item)) {
    return { kind: 'free' };
  }

  return buildDuplicateTargetMovementClassification(latestDeployment, false);
}

function isReusableHistoricalTargetMovementMatch(
  latestDeployment: PersistedTargetDeploymentRow | undefined,
  item: SerializedDeploymentMovementBatchItem,
): latestDeployment is PersistedTargetDeploymentRow {
  if (latestDeployment?.deployment.status !== 'succeeded') {
    return false;
  }

  return isExactTargetDeploymentMovementMatch(latestDeployment, item);
}

function buildDuplicateTargetMovementClassification(
  deployment: PersistedTargetDeploymentRow,
  inFlight: boolean,
): TargetMovementClassification {
  return {
    deployment: toDeploymentRow(deployment.deployment),
    inFlight,
    kind: 'duplicate',
  };
}

function isInFlightMovementTargetDeployment(deployment: PersistedTargetDeploymentRow): boolean {
  return (
    isMovementTargetDeployment(deployment) &&
    (deployment.deployment.status === 'queued' || deployment.deployment.status === 'running')
  );
}

function isExactTargetDeploymentMovementMatch(
  deployment: PersistedTargetDeploymentRow,
  item: SerializedDeploymentMovementBatchItem,
): boolean {
  return (
    isMovementTargetDeployment(deployment) &&
    deployment.deployment.movementSourceDeploymentId === item.sourceDeploymentId &&
    deployment.operationType === item.operationType
  );
}

function isMovementTargetDeployment(deployment: PersistedTargetDeploymentRow): boolean {
  return deployment.operationType === 'deployment.promote' || deployment.operationType === 'deployment.rollback';
}

function toResolvedDuplicateMovementItem(
  deployment: DeploymentRow,
  requestIndex: number,
): ResolvedDeploymentMovementBatchItem {
  return {
    deployment,
    requestIndex,
  };
}

function readSerializedDeploymentMovementTargetKey(item: SerializedDeploymentMovementBatchItem): string {
  return readDeploymentMovementTargetKey(toMovementTargetSelector(item));
}

function toMovementTargetSelector(item: SerializedDeploymentMovementBatchItem): DeploymentMovementTargetSelector {
  return {
    environmentId: item.item.deployment.environmentId,
    projectServiceId: item.item.deployment.projectServiceId,
  };
}
