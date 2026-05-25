import type { DeploymentMovementTargetSelector, PersistedTargetDeploymentRow } from './deployment-movement.query.types';

export function groupTargetDeploymentsByTarget(
  rows: PersistedTargetDeploymentRow[],
): Map<string, PersistedTargetDeploymentRow[]> {
  const groupedRows: Map<string, PersistedTargetDeploymentRow[]> = new Map<string, PersistedTargetDeploymentRow[]>();

  for (const row of rows) {
    const targetKey: string = readDeploymentMovementTargetKey({
      environmentId: row.deployment.environmentId,
      projectServiceId: row.deployment.projectServiceId,
    });
    const targetRows: PersistedTargetDeploymentRow[] = groupedRows.get(targetKey) ?? [];

    targetRows.push(row);
    groupedRows.set(targetKey, targetRows);
  }

  return groupedRows;
}

export function readDeploymentMovementTargetKey(target: DeploymentMovementTargetSelector): string {
  return `${target.environmentId}:${target.projectServiceId}`;
}
