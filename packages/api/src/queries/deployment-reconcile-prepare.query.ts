import { and, eq, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { readCompartmentArtifactImageDigest } from '@compartment/contracts';
import { buildArtifacts, deploymentKubeReferences, deployments, environments, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { ensureDeploymentRouteWithExecutor } from './deployment-route-persistence.query';
import type { DeploymentTransaction } from './deployments.query.types';
import {
  lockTerminalProvisioningForDeployment,
  propagateTerminalProvisioningRow,
} from './project-provisioning-terminal.query';
import type { TerminalProvisioningRow } from './project-provisioning-terminal.query.types';
import {
  buildDeploymentKubeReferenceValues,
  type DeploymentKubeReferenceValues,
} from './deployment-kube-reference-values';
import type {
  PrepareDeploymentProjectRow,
  PrepareDeploymentReconcileInput,
  PrepareDeploymentReconcileResult,
  PrepareDeploymentRow,
} from './deployment-reconcile.query.types';

interface PersistedSbomMarker {
  id: string;
}

export async function prepareDeploymentReconcileReference(
  input: PrepareDeploymentReconcileInput,
): Promise<PrepareDeploymentReconcileResult> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<PrepareDeploymentReconcileResult> =>
      await prepareWithTransaction(tx, input),
  );
}

async function prepareWithTransaction(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
): Promise<PrepareDeploymentReconcileResult> {
  const terminal: TerminalProvisioningRow | undefined = await lockTerminalProvisioningForDeployment(
    tx,
    input.deploymentId,
  );
  const project: PrepareDeploymentProjectRow = await lockPrepareProject(tx, input.deploymentId);
  if (project.archivedAt !== null) {
    return 'project-archived';
  }
  const deployment: PrepareDeploymentRow = await lockPrepareDeployment(tx, input.deploymentId);
  const now: Date = new Date();
  await updateBuildArtifact(tx, input, deployment, now);
  await insertDesiredReference(tx, input, now);
  await upsertPreparedRoute(tx, input, deployment, now);
  await propagateTerminalProvisioningRow(tx, terminal, now);
  return 'prepared';
}

async function lockPrepareProject(
  tx: DeploymentTransaction,
  deploymentId: string,
): Promise<PrepareDeploymentProjectRow> {
  const [project] = await tx
    .select({ archivedAt: projects.archivedAt })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(deployments.id, deploymentId))
    .for('update', { of: projects });
  if (project === undefined) {
    throw new Error(`Project for deployment ${deploymentId} was not found.`);
  }
  return project;
}

async function updateBuildArtifact(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
  deployment: PrepareDeploymentRow,
  now: Date,
): Promise<void> {
  const imageDigest: string = requireImageDigest(input.imageRef);
  const [artifact] = await tx
    .update(buildArtifacts)
    .set({
      buildOwnerDeploymentId: null,
      buildState: 'ready',
      imageCleanedAt: null,
      imageRef: input.imageRef,
      imageRetentionState: 'available',
      updatedAt: now,
    })
    .where(requirePersistedSbomFilter(deployment.buildArtifactId, input.deploymentId, input.imageRef, imageDigest))
    .returning({ id: buildArtifacts.id });
  requirePersistedArtifactSbom(artifact);
}

function requirePersistedSbomFilter(
  artifactId: string,
  deploymentId: string,
  imageRef: string,
  imageDigest: string,
): SQL | undefined {
  return and(
    eq(buildArtifacts.id, artifactId),
    or(
      eq(buildArtifacts.buildOwnerDeploymentId, deploymentId),
      and(
        isNull(buildArtifacts.buildOwnerDeploymentId),
        eq(buildArtifacts.buildState, 'ready'),
        eq(buildArtifacts.imageRef, imageRef),
        eq(buildArtifacts.imageRetentionState, 'available'),
      ),
    ),
    eq(buildArtifacts.sbomImageDigest, imageDigest),
    isNotNull(buildArtifacts.sbomDigest),
    isNotNull(buildArtifacts.sbomJson),
  );
}

function requireImageDigest(imageRef: string): string {
  const digest: string | null = readCompartmentArtifactImageDigest(imageRef);
  if (digest === null) {
    throw new Error('Build artifact readiness requires a digest-pinned image.');
  }
  return digest;
}

function requirePersistedArtifactSbom(artifact: PersistedSbomMarker | undefined): void {
  if (artifact === undefined) {
    throw new Error('Build artifact readiness requires a persisted SBOM.');
  }
}

async function insertDesiredReference(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
  now: Date,
): Promise<void> {
  const values: DeploymentKubeReferenceValues = buildDeploymentKubeReferenceValues(input, now);
  await tx
    .insert(deploymentKubeReferences)
    .values(values)
    .onConflictDoNothing({ target: deploymentKubeReferences.deploymentId });
}

async function upsertPreparedRoute(
  tx: DeploymentTransaction,
  input: PrepareDeploymentReconcileInput,
  deployment: PrepareDeploymentRow,
  now: Date,
): Promise<void> {
  await ensureDeploymentRouteWithExecutor(tx, {
    accessScopeId: deployment.environmentId,
    accessScopeType: 'environment',
    deploymentId: input.deploymentId,
    environmentId: deployment.environmentId,
    id: input.routeId,
    serviceId: deployment.serviceId,
    subdomain: input.routeSubdomain,
    updatedAt: now,
  });
}

async function lockPrepareDeployment(tx: DeploymentTransaction, deploymentId: string): Promise<PrepareDeploymentRow> {
  const [deployment] = await tx
    .select({
      buildArtifactId: deployments.buildArtifactId,
      environmentId: deployments.environmentId,
      serviceId: deployments.projectServiceId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .for('update');
  if (deployment === undefined) {
    throw new Error(`Deployment ${deploymentId} was not found.`);
  }
  return deployment;
}
