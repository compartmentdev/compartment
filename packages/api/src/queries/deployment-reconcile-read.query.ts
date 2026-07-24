import { and, asc, eq, lte, ne, notExists, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { BuildAliasTable, SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import {
  buildArtifacts,
  deploymentKubeReferences,
  deployments,
  environments,
  organizations,
  projectServices,
  projectKubeProvisioning,
  projects,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import type { DeploymentReconcilePair, DeploymentReconcileRow } from './deployment-reconcile.query.types';

const replacementDeployments: BuildAliasTable<typeof deployments, 'replacement_deployments'> = alias(
  deployments,
  'replacement_deployments',
);
const replacementReferences: BuildAliasTable<typeof deploymentKubeReferences, 'replacement_references'> = alias(
  deploymentKubeReferences,
  'replacement_references',
);

interface ReconcileSelection extends SelectedFields {
  deploymentId: typeof deployments.id;
  environmentId: typeof environments.id;
  environmentName: typeof environments.name;
  image: typeof buildArtifacts.imageRef;
  organizationId: typeof organizations.id;
  organizationName: typeof organizations.name;
  projectId: typeof projects.id;
  projectName: typeof projects.name;
  resolvedPortsJson: typeof deployments.resolvedPortsJson;
  resolvedReadinessJson: typeof deployments.resolvedReadinessJson;
  resolvedReleaseJson: typeof deployments.resolvedReleaseJson;
  resolvedRunJson: typeof deployments.resolvedRunJson;
  revision: typeof deploymentKubeReferences.revision;
  serviceId: typeof projectServices.id;
  serviceName: typeof projectServices.name;
  state: typeof deploymentKubeReferences.state;
  transitionedAt: typeof deploymentKubeReferences.transitionedAt;
}

export async function findNextDeploymentReconcilePair(): Promise<DeploymentReconcilePair | null> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<DeploymentReconcilePair | null> => await claimReconcilePair(tx),
  );
}

async function claimReconcilePair(tx: DeploymentTransaction): Promise<DeploymentReconcilePair | null> {
  const candidates: DeploymentReconcileRow[] = await findCandidateReconcileRows(tx);
  const candidate: DeploymentReconcileRow | undefined = candidates[0];
  if (candidate === undefined) {
    return null;
  }
  const revision: number = candidate.revision + 1;
  await claimCandidateRevision(tx, candidate, revision);
  const activeRows: DeploymentReconcileRow[] = await findActiveReconcileRows(tx, candidate);
  return { active: activeRows[0] ?? null, candidate: { ...candidate, revision } };
}

async function claimCandidateRevision(
  tx: DeploymentTransaction,
  candidate: DeploymentReconcileRow,
  revision: number,
): Promise<void> {
  await tx
    .update(deploymentKubeReferences)
    .set({ revision, updatedAt: new Date(Date.now() + 2_000) })
    .where(eq(deploymentKubeReferences.deploymentId, candidate.deploymentId));
}

async function findActiveReconcileRows(
  tx: DeploymentTransaction,
  candidate: DeploymentReconcileRow,
): Promise<DeploymentReconcileRow[]> {
  return await tx
    .select(reconcileSelection())
    .from(deploymentKubeReferences)
    .innerJoin(deployments, eq(deploymentKubeReferences.deploymentId, deployments.id))
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .innerJoin(buildArtifacts, eq(deployments.buildArtifactId, buildArtifacts.id))
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .innerJoin(projectServices, eq(deployments.projectServiceId, projectServices.id))
    .where(
      and(
        eq(deployments.environmentId, candidate.environmentId),
        eq(deployments.projectServiceId, candidate.serviceId),
        eq(deployments.isActive, true),
      ),
    )
    .limit(1);
}

async function findCandidateReconcileRows(tx: DeploymentTransaction): Promise<DeploymentReconcileRow[]> {
  return await Promise.resolve(
    tx
      .select(reconcileSelection())
      .from(deploymentKubeReferences)
      .innerJoin(deployments, eq(deploymentKubeReferences.deploymentId, deployments.id))
      .innerJoin(buildArtifacts, eq(deployments.buildArtifactId, buildArtifacts.id))
      .innerJoin(environments, eq(deployments.environmentId, environments.id))
      .innerJoin(projects, eq(environments.projectId, projects.id))
      .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, projects.id))
      .innerJoin(organizations, eq(projects.organizationId, organizations.id))
      .innerJoin(projectServices, eq(deployments.projectServiceId, projectServices.id))
      .where(candidateFilter(tx))
      .orderBy(candidatePriority(), asc(deploymentKubeReferences.updatedAt))
      .limit(1)
      .for('update', { skipLocked: true }),
  );
}

function candidatePriority(): SQL {
  return sql`CASE WHEN ${deploymentKubeReferences.state} = 'active' THEN 1 ELSE 0 END`;
}

function candidateFilter(tx: DeploymentTransaction): SQL | undefined {
  return and(
    lte(deploymentKubeReferences.updatedAt, new Date()),
    or(
      eq(deploymentKubeReferences.state, 'stopping'),
      and(
        eq(projectKubeProvisioning.state, 'succeeded'),
        or(
          and(eq(deploymentKubeReferences.state, 'desired'), eq(deployments.status, 'running')),
          and(
            eq(deploymentKubeReferences.state, 'pending'),
            or(eq(deployments.status, 'running'), eq(deployments.status, 'succeeded')),
          ),
          and(
            eq(deploymentKubeReferences.state, 'active'),
            eq(deployments.status, 'succeeded'),
            eq(deployments.isActive, true),
            noRunnableReplacement(tx),
          ),
        ),
      ),
    ),
  );
}

function noRunnableReplacement(tx: DeploymentTransaction): SQL {
  return notExists(
    tx
      .select({ id: replacementReferences.id })
      .from(replacementReferences)
      .innerJoin(replacementDeployments, eq(replacementReferences.deploymentId, replacementDeployments.id))
      .where(
        and(
          eq(replacementDeployments.environmentId, deployments.environmentId),
          eq(replacementDeployments.projectServiceId, deployments.projectServiceId),
          ne(replacementDeployments.id, deployments.id),
          or(
            and(eq(replacementReferences.state, 'desired'), eq(replacementDeployments.status, 'running')),
            and(
              eq(replacementReferences.state, 'pending'),
              or(eq(replacementDeployments.status, 'running'), eq(replacementDeployments.status, 'succeeded')),
            ),
          ),
        ),
      ),
  );
}

function reconcileSelection(): ReconcileSelection {
  return {
    deploymentId: deployments.id,
    environmentId: environments.id,
    environmentName: environments.name,
    image: buildArtifacts.imageRef,
    organizationId: organizations.id,
    organizationName: organizations.name,
    projectId: projects.id,
    projectName: projects.name,
    resolvedPortsJson: deployments.resolvedPortsJson,
    resolvedReadinessJson: deployments.resolvedReadinessJson,
    resolvedReleaseJson: deployments.resolvedReleaseJson,
    resolvedRunJson: deployments.resolvedRunJson,
    revision: deploymentKubeReferences.revision,
    serviceId: projectServices.id,
    serviceName: projectServices.name,
    state: deploymentKubeReferences.state,
    transitionedAt: deploymentKubeReferences.transitionedAt,
  };
}
