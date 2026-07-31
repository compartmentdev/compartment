import { eq } from 'drizzle-orm';
import {
  deployments,
  environments,
  operations,
  organizations,
  principals,
  projects,
  projectServices,
} from '../db/schema';
import { insertAuditEventWithExecutor } from './audit-events.query';
import type { AuditEventRow, InsertAuditEventInput } from './audit-events.query.types';
import type { DeploymentTransaction } from './deployments.query.types';
import type { PersistDeploymentReconcileObservationInput } from './deployment-reconcile.query.types';

interface DeploymentDriftContext {
  environmentId: string;
  organizationId: string;
  projectId: string;
  serviceId: string;
}

interface DeploymentAccessModeAuditContext extends DeploymentDriftContext {
  accessMode: 'authenticated' | 'public';
  actorEmail: string | null;
  actorPrincipalId: string | null;
  actorType: string | null;
  serviceName: string;
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

export async function persistDeploymentAccessModeChange(
  tx: DeploymentTransaction,
  input: PersistDeploymentReconcileObservationInput,
  previousActiveId: string | undefined,
): Promise<AuditEventRow | null> {
  const context: DeploymentAccessModeAuditContext = await requireDeploymentAccessModeAuditContext(
    tx,
    input.deploymentId,
  );
  const previousAccessMode: 'authenticated' | 'public' | null =
    previousActiveId === undefined ? null : await readDeploymentAccessMode(tx, previousActiveId);
  if (context.accessMode === previousAccessMode || (previousAccessMode === null && context.accessMode !== 'public')) {
    return null;
  }
  return await insertAuditEventWithExecutor(
    tx,
    buildDeploymentAccessAuditEventInput(context, input, previousAccessMode),
  );
}

function buildDeploymentAccessAuditEventInput(
  context: DeploymentAccessModeAuditContext,
  input: PersistDeploymentReconcileObservationInput,
  previousAccessMode: 'authenticated' | 'public' | null,
): InsertAuditEventInput {
  return {
    actorEmail: context.actorEmail,
    actorPrincipalId: context.actorPrincipalId,
    actorType: context.actorType === 'automation' ? 'automation' : 'user',
    environmentId: context.environmentId,
    eventType: 'service.access_mode.changed',
    occurredAt: input.observedAt,
    metadata: { currentAccessMode: context.accessMode, previousAccessMode },
    organizationId: context.organizationId,
    projectId: context.projectId,
    projectServiceId: context.serviceId,
    scopeType: 'organization',
    status: 'succeeded',
    targetDisplayName: context.serviceName,
    targetId: context.serviceId,
    targetType: 'service',
  };
}

async function requireDeploymentAccessModeAuditContext(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<DeploymentAccessModeAuditContext> {
  const [context] = await findAccessModeAuditContexts(tx, deploymentId);
  if (context === undefined) {
    throw new Error(`Deployment ${deploymentId} access-mode audit context was not found.`);
  }
  return context;
}

async function findAccessModeAuditContexts(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<DeploymentAccessModeAuditContext[]> {
  return await tx
    .select({
      accessMode: deployments.accessMode,
      actorEmail: principals.email,
      actorPrincipalId: operations.actorPrincipalId,
      actorType: principals.type,
      environmentId: deployments.environmentId,
      organizationId: organizations.id,
      projectId: projects.id,
      serviceId: deployments.projectServiceId,
      serviceName: projectServices.name,
    })
    .from(deployments)
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .innerJoin(projectServices, eq(deployments.projectServiceId, projectServices.id))
    .innerJoin(operations, eq(deployments.operationId, operations.id))
    .leftJoin(principals, eq(operations.actorPrincipalId, principals.id))
    .where(eq(deployments.id, deploymentId));
}

async function readDeploymentAccessMode(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<'authenticated' | 'public'> {
  const [deployment] = await tx
    .select({ accessMode: deployments.accessMode })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (deployment === undefined) {
    throw new Error(`Previous deployment ${deploymentId} was not found.`);
  }
  return deployment.accessMode;
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
