import { eq } from 'drizzle-orm';
import { deployments } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentRow, PersistedDeploymentRow } from './deployments.query.types';
import type { MarkDeploymentStoppedInput } from './deployment-lifecycle.query.types';
import { toDeploymentRow } from './deployments.query';

export async function markDeploymentStopped(input: MarkDeploymentStoppedInput): Promise<DeploymentRow> {
  const [deployment]: PersistedDeploymentRow[] = await getApiDatabase()
    .update(deployments)
    .set({
      health: 'healthy',
      isActive: false,
      promotionStage: 'stopped',
      status: 'stopped',
      updatedAt: input.updatedAt,
    })
    .where(eq(deployments.id, input.deploymentId))
    .returning();

  return toDeploymentRow(requirePersistedRow(deployment));
}

function requirePersistedRow(row: PersistedDeploymentRow | undefined): PersistedDeploymentRow {
  if (row === undefined) {
    throw new Error('Failed to persist deployment.');
  }

  return row;
}
