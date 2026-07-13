import type { CompartmentAccessScopeType } from '@compartment/contracts';
import { eq } from 'drizzle-orm';
import { deploymentRoutes, deployments } from '../db/schema';
import type {
  DeploymentRouteOwnerRow,
  DeploymentRouteOwnerSelection,
  DeploymentRouteQueryExecutor,
  InsertedDeploymentRouteRow,
  UpsertDeploymentRouteInput,
} from './deployment-routes.query.types';

interface DeploymentRouteInsertInput {
  accessScopeId: string;
  accessScopeType: CompartmentAccessScopeType;
  deploymentId: string;
  id: string;
  subdomain: string;
  updatedAt: Date;
}

const deploymentRouteOwnerSelection: DeploymentRouteOwnerSelection = {
  environmentId: deployments.environmentId,
  serviceId: deployments.projectServiceId,
  subdomain: deploymentRoutes.subdomain,
};

export async function upsertDeploymentRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
): Promise<void> {
  await persistDeploymentRouteWithExecutor(executor, input, true);
}

export async function ensureDeploymentRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
): Promise<void> {
  await persistDeploymentRouteWithExecutor(executor, input, false);
}

async function persistDeploymentRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
  moveExistingRoute: boolean,
): Promise<void> {
  if (await tryInsertDeploymentRouteWithExecutor(executor, input)) {
    return;
  }
  await assertMatchingDeploymentRouteOwner(executor, input);
  if (moveExistingRoute) {
    await moveDeploymentRoute(executor, input);
  }
}

export async function tryInsertDeploymentRouteWithExecutor(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
): Promise<boolean> {
  const insertedRoutes: InsertedDeploymentRouteRow[] = await executor
    .insert(deploymentRoutes)
    .values(buildDeploymentRouteInsertInput(input))
    .onConflictDoNothing({ target: deploymentRoutes.subdomain })
    .returning({ id: deploymentRoutes.id });
  return insertedRoutes.length > 0;
}

async function moveDeploymentRoute(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
): Promise<void> {
  await executor
    .update(deploymentRoutes)
    .set({
      accessScopeId: input.accessScopeId,
      accessScopeType: input.accessScopeType,
      deploymentId: input.deploymentId,
      updatedAt: input.updatedAt,
    })
    .where(eq(deploymentRoutes.subdomain, input.subdomain));
}

async function assertMatchingDeploymentRouteOwner(
  executor: DeploymentRouteQueryExecutor,
  input: UpsertDeploymentRouteInput,
): Promise<void> {
  const owner: DeploymentRouteOwnerRow | undefined = await findDeploymentRouteOwner(executor, input.subdomain);
  if (owner?.environmentId !== input.environmentId || owner.serviceId !== input.serviceId) {
    throw new Error(`Public route subdomain ${input.subdomain} is already assigned to another deployment route.`);
  }
}

async function findDeploymentRouteOwner(
  executor: DeploymentRouteQueryExecutor,
  subdomain: string,
): Promise<DeploymentRouteOwnerRow | undefined> {
  const rows: DeploymentRouteOwnerRow[] = await executor
    .select(deploymentRouteOwnerSelection)
    .from(deploymentRoutes)
    .innerJoin(deployments, eq(deploymentRoutes.deploymentId, deployments.id))
    .where(eq(deploymentRoutes.subdomain, subdomain))
    .limit(1);
  return rows[0];
}

function buildDeploymentRouteInsertInput(input: UpsertDeploymentRouteInput): DeploymentRouteInsertInput {
  return {
    accessScopeId: input.accessScopeId,
    accessScopeType: input.accessScopeType,
    deploymentId: input.deploymentId,
    id: input.id,
    subdomain: input.subdomain,
    updatedAt: input.updatedAt,
  };
}
