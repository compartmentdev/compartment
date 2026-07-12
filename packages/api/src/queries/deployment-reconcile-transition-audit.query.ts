import { eq } from 'drizzle-orm';
import { deployments, environments, organizations, projects } from '../db/schema';
import { insertAuditEventWithExecutor } from './audit-events.query';
import type { DeploymentTransaction } from './deployments.query.types';
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';

interface DeploymentDriftContext {
  environmentId: string;
  organizationId: string;
  projectId: string;
  serviceId: string;
}

export async function persistActiveDeploymentDrift(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
): Promise<void> {
  const [context] = await findDriftContext(tx, input.deploymentId);
  if (context === undefined) {
    throw new Error(`Deployment ${input.deploymentId} drift context was not found.`);
  }
  const message: string = input.failureMessage ?? 'Active Kubernetes Deployment drifted or became non-Ready.';
  await insertAuditEventWithExecutor(tx, {
    actorType: 'system',
    environmentId: context.environmentId,
    eventType: 'deployment.kubernetes.drift_detected',
    occurredAt: input.observedAt,
    metadata: { driftKind: 'non-ready', message },
    organizationId: context.organizationId,
    projectId: context.projectId,
    projectServiceId: context.serviceId,
    scopeType: 'organization',
    status: 'succeeded',
    targetId: input.deploymentId,
    targetType: 'deployment',
  });
}

async function findDriftContext(tx: DeploymentTransaction, deploymentId: string): Promise<DeploymentDriftContext[]> {
  return await tx
    .select({
      environmentId: deployments.environmentId,
      organizationId: organizations.id,
      projectId: projects.id,
      serviceId: deployments.projectServiceId,
    })
    .from(deployments)
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .where(eq(deployments.id, deploymentId))
    .limit(1);
}
