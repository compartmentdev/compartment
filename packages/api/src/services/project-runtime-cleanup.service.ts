import {
  createProjectArchiveRuntimeStopFailedError,
  createProjectDeleteRuntimeCleanupFailedError,
} from '../errors/api-business-error';
import { listRuntimeJoinedDeploymentsForProject } from '../queries/deployment-joined.query';
import { listProjectEnvironmentsByProjectIds } from '../queries/deployment-context.query';
import { markDeploymentStopped } from '../queries/deployment-lifecycle.query';
import { findDeploymentKubeState } from '../queries/deployment-kube-membership.query';
import type { DeploymentKubeState } from '../queries/deployment-kube-state.types';
import type { DeploymentJoinedRow, EnvironmentRow } from '../queries/deployments.query.types';
import { findOrganizationById } from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import { listProjectResourcesByEnvironmentId } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { stopKubeProjectDeployment } from './project-lifecycle-kube-stop.service';
import {
  deleteKubernetesResource,
  reconcileKubernetesResourceReplicas,
} from './resources-kubernetes-reconcile.service';
import type { ResourceEnvironmentContext } from './resources.service.types';

interface ProjectRuntimeCleanupResource {
  context: ResourceEnvironmentContext;
  resource: ProjectResourceRow;
}

interface ProjectRuntimeCleanupPlan {
  deployments: DeploymentJoinedRow[];
  resources: ProjectRuntimeCleanupResource[];
}

export async function cleanupArchivedProjectRuntime(project: ProjectRow): Promise<void> {
  try {
    const plan: ProjectRuntimeCleanupPlan = await buildProjectRuntimeCleanupPlan(project);
    await stopKubeProjectDeployments(plan.deployments);
    await stopKubeProjectResources(plan.resources);
    await markProjectDeploymentsStopped(plan.deployments);
  } catch {
    throw createProjectArchiveRuntimeStopFailedError();
  }
}

export async function cleanupDeletedProjectRuntime(project: ProjectRow): Promise<void> {
  try {
    const plan: ProjectRuntimeCleanupPlan = await buildProjectRuntimeCleanupPlan(project);
    await stopKubeProjectDeployments(plan.deployments);
    await deleteKubeProjectResources(plan.resources);
  } catch {
    throw createProjectDeleteRuntimeCleanupFailedError();
  }
}

async function buildProjectRuntimeCleanupPlan(project: ProjectRow): Promise<ProjectRuntimeCleanupPlan> {
  const organization: OrganizationRow | undefined = await findOrganizationById(project.organizationId);
  if (organization === undefined) {
    throw new Error('Project organization not found.');
  }
  const environments: EnvironmentRow[] = await listProjectEnvironmentsByProjectIds([project.id]);
  return {
    deployments: await listRuntimeJoinedDeploymentsForProject(project.id, getApiConfig().baseDomain),
    resources: await listProjectRuntimeCleanupResources(project, organization, environments),
  };
}

async function stopKubeProjectDeployments(deployments: DeploymentJoinedRow[]): Promise<void> {
  const updatedAt: Date = new Date();
  for (const deployment of deployments) {
    const state: DeploymentKubeState | undefined = await findDeploymentKubeState(deployment.deployment.id);
    if (state !== undefined) {
      await stopKubeProjectDeployment(deployment.deployment.id, state, updatedAt);
    }
  }
}

async function stopKubeProjectResources(resources: ProjectRuntimeCleanupResource[]): Promise<void> {
  for (const item of resources) {
    if (item.resource.status === 'deleting') {
      await deleteKubernetesResource(item.context, item.resource, false);
    } else {
      await reconcileKubernetesResourceReplicas(item.context, item.resource, 0);
    }
  }
}

async function deleteKubeProjectResources(resources: ProjectRuntimeCleanupResource[]): Promise<void> {
  for (const item of resources) {
    await deleteKubernetesResource(item.context, item.resource, true);
  }
}

async function listProjectRuntimeCleanupResources(
  project: ProjectRow,
  organization: OrganizationRow,
  environments: EnvironmentRow[],
): Promise<ProjectRuntimeCleanupResource[]> {
  const resources: ProjectRuntimeCleanupResource[] = [];
  for (const environment of environments) {
    const rows: ProjectResourceRow[] = await listProjectResourcesByEnvironmentId(environment.id);
    resources.push(
      ...rows.map(
        (resource: ProjectResourceRow): ProjectRuntimeCleanupResource => ({
          context: { environment, organization, project },
          resource,
        }),
      ),
    );
  }
  return resources;
}

async function markProjectDeploymentsStopped(deployments: DeploymentJoinedRow[]): Promise<void> {
  const updatedAt: Date = new Date();
  for (const deployment of deployments) {
    if (deployment.deployment.status !== 'failed') {
      await markDeploymentStopped({ deploymentId: deployment.deployment.id, updatedAt });
    }
  }
}
