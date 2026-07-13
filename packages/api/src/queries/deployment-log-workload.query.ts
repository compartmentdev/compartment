import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import { deploymentKubeReferences } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentLogWorkloadRow, DeploymentLogWorkloadScopeRow } from './deployment-log-workload.query.types';

export async function listKubeDeploymentIds(deploymentIds: string[]): Promise<string[]> {
  if (deploymentIds.length === 0) {
    return [];
  }
  const rows: { deploymentId: string }[] = await getApiDatabase()
    .select({ deploymentId: deploymentKubeReferences.deploymentId })
    .from(deploymentKubeReferences)
    .where(inArray(deploymentKubeReferences.deploymentId, deploymentIds));
  return rows.map((row: { deploymentId: string }): string => row.deploymentId);
}

export async function listDeploymentLogWorkloadScopes(
  currentDeploymentIds: string[],
): Promise<DeploymentLogWorkloadScopeRow[]> {
  if (currentDeploymentIds.length === 0) {
    return [];
  }
  const current: DeploymentLogWorkloadRow[] = await readCurrentDeploymentWorkloads(currentDeploymentIds);
  if (current.length === 0) {
    return [];
  }
  return mapDeploymentLogWorkloadScopes(current, await readRelatedDeploymentWorkloads(current));
}

async function readCurrentDeploymentWorkloads(deploymentIds: string[]): Promise<DeploymentLogWorkloadRow[]> {
  return await getApiDatabase()
    .select({
      deploymentId: deploymentKubeReferences.deploymentId,
      deploymentName: deploymentKubeReferences.deploymentName,
      namespace: deploymentKubeReferences.namespace,
    })
    .from(deploymentKubeReferences)
    .where(inArray(deploymentKubeReferences.deploymentId, deploymentIds));
}

async function readRelatedDeploymentWorkloads(
  current: DeploymentLogWorkloadRow[],
): Promise<DeploymentLogWorkloadRow[]> {
  return await getApiDatabase()
    .select({
      deploymentId: deploymentKubeReferences.deploymentId,
      deploymentName: deploymentKubeReferences.deploymentName,
      namespace: deploymentKubeReferences.namespace,
    })
    .from(deploymentKubeReferences)
    .where(buildWorkloadPredicate(current));
}

function buildWorkloadPredicate(current: DeploymentLogWorkloadRow[]): SQL | undefined {
  return or(
    ...current.map(
      (workload: DeploymentLogWorkloadRow): SQL =>
        and(
          eq(deploymentKubeReferences.namespace, workload.namespace),
          eq(deploymentKubeReferences.deploymentName, workload.deploymentName),
        )!,
    ),
  );
}

function mapDeploymentLogWorkloadScopes(
  current: DeploymentLogWorkloadRow[],
  related: DeploymentLogWorkloadRow[],
): DeploymentLogWorkloadScopeRow[] {
  return related.flatMap((row: DeploymentLogWorkloadRow): DeploymentLogWorkloadScopeRow[] => {
    const active: DeploymentLogWorkloadRow | undefined = current.find(
      (workload: DeploymentLogWorkloadRow): boolean =>
        workload.namespace === row.namespace && workload.deploymentName === row.deploymentName,
    );
    return active === undefined ? [] : [{ currentDeploymentId: active.deploymentId, deploymentId: row.deploymentId }];
  });
}
