import { and, eq, ne } from 'drizzle-orm';
import { buildArtifacts, deployments } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { upsertDeploymentRouteWithExecutor } from './deployment-routes.query';
import type { CompleteDeploymentWithRouteInput } from './deployment-completion.query.types';
import type { DeploymentTransaction } from './deployments.query.types';
import { updateOperationRecordWithExecutor } from './operations.query';

export async function completeDeploymentWithRoute(input: CompleteDeploymentWithRouteInput): Promise<void> {
  await getApiDatabase().transaction(async (tx: DeploymentTransaction): Promise<void> => {
    await updateBuildArtifactImage(tx, input.buildArtifactId, input.imageRef, input.updatedAt);
    await markOtherDeploymentsInactive(tx, input.environmentId, input.serviceId, input.deploymentId, input.updatedAt);
    await markDeploymentCompleted(tx, input);
    await upsertDeploymentRouteWithExecutor(tx, {
      accessScopeId: input.accessScopeId,
      accessScopeType: input.accessScopeType,
      deploymentId: input.deploymentId,
      environmentId: input.environmentId,
      id: input.routeId,
      serviceId: input.serviceId,
      subdomain: input.routeSubdomain,
      updatedAt: input.updatedAt,
    });
    await updateOperationRecordWithExecutor(tx, {
      completedAt: input.completedAt,
      operationId: input.operationId,
      status: 'succeeded',
      summary: `Deployment ${input.deploymentId} is active on ${input.routeHost}`,
    });
  });
}

async function updateBuildArtifactImage(
  tx: DeploymentTransaction,
  buildArtifactId: string,
  imageRef: string,
  updatedAt: Date,
): Promise<void> {
  await tx
    .update(buildArtifacts)
    .set({
      imageCleanedAt: null,
      imageRef,
      imageRetentionState: 'available',
      updatedAt,
    })
    .where(eq(buildArtifacts.id, buildArtifactId));
}

async function markOtherDeploymentsInactive(
  tx: DeploymentTransaction,
  environmentId: string,
  projectServiceId: string,
  excludeDeploymentId: string,
  updatedAt: Date,
): Promise<void> {
  await tx
    .update(deployments)
    .set({
      isActive: false,
      updatedAt,
    })
    .where(
      and(
        eq(deployments.environmentId, environmentId),
        eq(deployments.projectServiceId, projectServiceId),
        eq(deployments.isActive, true),
        ne(deployments.id, excludeDeploymentId),
      ),
    );
}

async function markDeploymentCompleted(
  tx: DeploymentTransaction,
  input: CompleteDeploymentWithRouteInput,
): Promise<void> {
  await tx
    .update(deployments)
    .set({
      completedAt: input.completedAt,
      containerId: input.containerId,
      drainDeadlineAt: input.drainDeadlineAt,
      drainingContainerId: input.drainingContainerId,
      drainingDeploymentId: input.drainingDeploymentId,
      drainingNodeId: input.drainingNodeId,
      health: 'healthy',
      isActive: true,
      promotionStage: input.promotionStage,
      upstreamHost: input.upstreamHost,
      upstreamPort: input.upstreamPort,
      status: 'succeeded',
      updatedAt: input.updatedAt,
    })
    .where(eq(deployments.id, input.deploymentId));
}
