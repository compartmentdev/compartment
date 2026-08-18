import { and, eq, ne, sql } from 'drizzle-orm';
import { deploymentKubeReferences, deployments } from '../db/schema';
import type { DeploymentTransaction } from './deployments.query.types';

interface SupersedePreviousKubeDeploymentInput {
  candidate: SupersedeCandidateContext;
  currentDeploymentId: string;
  observedAt: Date;
  previousActiveId: string | undefined;
}

export interface SupersedeCandidateContext {
  createdAt: Date;
  deploymentRunId: string;
  environmentId: string;
  isActive: boolean;
  serviceId: string;
}

export async function supersedePreviousKubeDeployment(
  tx: DeploymentTransaction,
  input: SupersedePreviousKubeDeploymentInput,
): Promise<void> {
  if (input.previousActiveId === undefined) {
    return;
  }
  await deactivatePreviousDeployments(tx, input);
  await retirePreviousReference(tx, input, input.previousActiveId);
}

async function deactivatePreviousDeployments(
  tx: DeploymentTransaction,
  input: SupersedePreviousKubeDeploymentInput,
): Promise<void> {
  await tx
    .update(deployments)
    .set({ isActive: false, updatedAt: input.observedAt })
    .where(
      and(
        eq(deployments.environmentId, input.candidate.environmentId),
        eq(deployments.projectServiceId, input.candidate.serviceId),
        eq(deployments.isActive, true),
        ne(deployments.id, input.currentDeploymentId),
      ),
    );
}

async function retirePreviousReference(
  tx: DeploymentTransaction,
  input: SupersedePreviousKubeDeploymentInput,
  previousActiveId: string,
): Promise<void> {
  await tx
    .update(deploymentKubeReferences)
    .set({
      observedAt: input.observedAt,
      revision: sql`${deploymentKubeReferences.revision} + 1`,
      state: 'stopped',
      transitionedAt: input.observedAt,
      updatedAt: input.observedAt,
    })
    .where(eq(deploymentKubeReferences.deploymentId, previousActiveId));
}
