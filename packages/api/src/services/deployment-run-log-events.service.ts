import type { DeploymentLogStream, DeploymentRunStepKey, DeploymentRunStepStatus } from '@compartment/contracts';
import type { DeploymentRunEventRow } from '../queries/deployment-run-events.query.types';

export function buildScopedDeploymentRunEventsForLogs(
  events: DeploymentRunEventRow[],
  deploymentIds: ReadonlySet<string>,
): DeploymentRunEventRow[] {
  return [...filterDeploymentRunEvents(events, deploymentIds)].sort(compareDeploymentRunEventsForLogs);
}

export function buildDeploymentRunLineEvents(
  events: DeploymentRunEventRow[],
  since: Date | undefined,
  tailLines: number | undefined,
): DeploymentRunEventRow[] {
  return trimRunEvents(filterRunEventsSince(events, since), tailLines);
}

function filterDeploymentRunEvents(
  events: DeploymentRunEventRow[],
  deploymentIds: ReadonlySet<string>,
): DeploymentRunEventRow[] {
  return events.filter(
    (event: DeploymentRunEventRow): boolean => event.deploymentId === null || deploymentIds.has(event.deploymentId),
  );
}

function trimRunEvents(events: DeploymentRunEventRow[], tailLines: number | undefined): DeploymentRunEventRow[] {
  if (tailLines === undefined || events.length <= tailLines) {
    return events;
  }

  return events.slice(-tailLines);
}

function filterRunEventsSince(events: DeploymentRunEventRow[], since: Date | undefined): DeploymentRunEventRow[] {
  if (since === undefined) {
    return events;
  }

  return events.filter((event: DeploymentRunEventRow): boolean => event.createdAt >= since);
}

function compareDeploymentRunEventsForLogs(left: DeploymentRunEventRow, right: DeploymentRunEventRow): number {
  const numericComparisons: number[] = [
    compareNumbers(left.createdAt.getTime(), right.createdAt.getTime()),
    compareNumbers(readStepSortOrder(left.stepKey), readStepSortOrder(right.stepKey)),
    compareNumbers(readStatusSortOrder(left.status), readStatusSortOrder(right.status)),
    compareNumbers(readStreamSortOrder(left.stream), readStreamSortOrder(right.stream)),
  ];

  for (const comparison of numericComparisons) {
    if (comparison !== 0) {
      return comparison;
    }
  }

  return compareDeploymentRunEventText(left, right);
}

function compareDeploymentRunEventText(left: DeploymentRunEventRow, right: DeploymentRunEventRow): number {
  const deploymentDifference: number = (left.deploymentId ?? '').localeCompare(right.deploymentId ?? '');
  if (deploymentDifference !== 0) {
    return deploymentDifference;
  }

  const messageDifference: number = left.message.localeCompare(right.message);
  if (messageDifference !== 0) {
    return messageDifference;
  }

  return left.id.localeCompare(right.id);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function readStepSortOrder(stepKey: DeploymentRunStepKey): number {
  switch (stepKey) {
    case 'queued':
      return 0;
    case 'preparing_source':
      return 1;
    case 'building_image':
      return 2;
    case 'publishing_image':
      return 3;
    case 'release':
      return 4;
    case 'starting_candidate':
      return 5;
    case 'checking_readiness':
      return 6;
    case 'switching_route':
      return 7;
    case 'draining_previous':
      return 8;
    case 'completed':
      return 9;
  }
}

function readStatusSortOrder(status: DeploymentRunStepStatus | null): number {
  switch (status) {
    case 'running':
      return 0;
    case null:
      return 1;
    case 'succeeded':
      return 2;
    case 'failed':
      return 3;
    case 'skipped':
      return 4;
  }
}

function readStreamSortOrder(stream: DeploymentLogStream): number {
  switch (stream) {
    case 'compartment':
      return 0;
    case 'stdout':
      return 1;
    case 'stderr':
      return 2;
  }
}
