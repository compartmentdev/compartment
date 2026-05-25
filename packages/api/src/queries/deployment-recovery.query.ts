import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { deployments } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { OrphanedRunningDeploymentRow, PendingDrainDeploymentRow } from './deployment-recovery.query.types';

export async function listOrphanedRunningDeployments(): Promise<OrphanedRunningDeploymentRow[]> {
  return await getApiDatabase()
    .select({
      id: deployments.id,
    })
    .from(deployments)
    .where(and(eq(deployments.status, 'running'), eq(deployments.isActive, false), isNull(deployments.completedAt)))
    .orderBy(desc(deployments.createdAt), desc(deployments.id));
}

export async function listPendingDrainDeployments(): Promise<PendingDrainDeploymentRow[]> {
  return await getApiDatabase()
    .select({
      id: deployments.id,
    })
    .from(deployments)
    .where(
      and(
        eq(deployments.promotionStage, 'draining_previous'),
        isNotNull(deployments.drainingContainerId),
        isNotNull(deployments.drainingDeploymentId),
        isNotNull(deployments.drainingNodeId),
      ),
    )
    .orderBy(desc(deployments.createdAt), desc(deployments.id));
}
