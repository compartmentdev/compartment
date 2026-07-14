import type { NodeProjectCleanupCaddyNetworkMode, NodeProjectCleanupResource } from '@compartment/contracts';
import { cleanupNodeProjectRuntime } from '@compartment/sdk';
import {
  createProjectArchiveRuntimeStopFailedError,
  createProjectDeleteRuntimeCleanupFailedError,
} from '../errors/api-business-error';
import { listActiveJoinedDeploymentsForProject } from '../queries/deployment-joined.query';
import { listProjectEnvironmentsByProjectIds } from '../queries/deployment-context.query';
import { markDeploymentStopped } from '../queries/deployment-lifecycle.query';
import { findDeploymentKubeState } from '../queries/deployment-kube-membership.query';
import type { DeploymentKubeState } from '../queries/deployment-kube-state.types';
import type { DeploymentJoinedRow, EnvironmentRow } from '../queries/deployments.query.types';
import { findNodeById } from '../queries/node.query';
import type { NodeRow } from '../queries/node.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import { hasSucceededProjectKubeProvisioning } from '../queries/project-provisioning.query';
import { listProjectResourcesByEnvironmentId, updateProjectResourceRuntime } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { createNodeRuntimeRequester } from './node-runtime-requester';
import { parseResourceVolumes } from './resources.service.storage';
import { stopKubeProjectDeployment } from './project-lifecycle-kube-stop.service';

interface ProjectRuntimeCleanupResource {
  environmentName: string;
  resource: ProjectResourceRow;
}

interface ProjectRuntimeCleanupPlan {
  deployments: DeploymentJoinedRow[];
  nodeResources: NodeProjectCleanupResource[];
  nodeRows: NodeRow[];
  project: ProjectRow;
  resources: ProjectRuntimeCleanupResource[];
}

const preservedCaddyNetworkMode: NodeProjectCleanupCaddyNetworkMode = 'preserve-stale';
const disconnectStaleCaddyNetworkMode: NodeProjectCleanupCaddyNetworkMode = 'disconnect-stale';

export async function cleanupArchivedProjectRuntime(project: ProjectRow): Promise<void> {
  try {
    const plan: ProjectRuntimeCleanupPlan = await buildProjectRuntimeCleanupPlan(project);
    await cleanupProjectRuntime(plan, false, preservedCaddyNetworkMode);
    await markProjectRuntimeStopped(project.id, plan.resources);
  } catch {
    throw createProjectArchiveRuntimeStopFailedError();
  }
}

export async function cleanupDeletedProjectRuntime(project: ProjectRow): Promise<void> {
  try {
    const plan: ProjectRuntimeCleanupPlan = await buildProjectRuntimeCleanupPlan(project);
    await cleanupProjectRuntime(plan, true, disconnectStaleCaddyNetworkMode);
  } catch {
    throw createProjectDeleteRuntimeCleanupFailedError();
  }
}

async function buildProjectRuntimeCleanupPlan(project: ProjectRow): Promise<ProjectRuntimeCleanupPlan> {
  const environments: EnvironmentRow[] = await listProjectEnvironmentsByProjectIds([project.id]);
  const resources: ProjectRuntimeCleanupResource[] = await listProjectRuntimeCleanupResources(environments);
  const nodeRows: NodeRow[] = (await hasSucceededProjectKubeProvisioning(project.id))
    ? []
    : await resolveProjectRuntimeNodes(environments);
  const nodeResources: NodeProjectCleanupResource[] = buildNodeProjectCleanupResources(resources);
  const deployments: DeploymentJoinedRow[] = await listActiveJoinedDeploymentsForProject(
    project.id,
    getApiConfig().baseDomain,
  );

  return {
    deployments,
    nodeResources,
    nodeRows,
    project,
    resources,
  };
}

async function cleanupProjectRuntime(
  plan: ProjectRuntimeCleanupPlan,
  deleteData: boolean,
  caddyNetworkMode: NodeProjectCleanupCaddyNetworkMode,
): Promise<void> {
  await cleanupKubeProjectRuntime(plan.deployments);
  for (const node of plan.nodeRows) {
    await cleanupNodeProjectRuntime(createNodeRuntimeRequester(node.nodeSocketPath), {
      caddyNetworkMode,
      deleteData,
      projectId: plan.project.id,
      projectName: plan.project.name,
      resources: plan.nodeResources,
    });
  }
}

async function cleanupKubeProjectRuntime(deployments: DeploymentJoinedRow[]): Promise<void> {
  const updatedAt: Date = new Date();
  for (const deployment of deployments) {
    const deploymentId: string = deployment.deployment.id;
    const state: DeploymentKubeState | undefined = await findDeploymentKubeState(deploymentId);
    if (state !== undefined) {
      await stopKubeProjectDeployment(deploymentId, state, updatedAt);
    }
  }
}

function buildNodeProjectCleanupResources(resources: ProjectRuntimeCleanupResource[]): NodeProjectCleanupResource[] {
  return resources.map(
    (resource: ProjectRuntimeCleanupResource): NodeProjectCleanupResource => ({
      environmentName: resource.environmentName,
      resourceName: resource.resource.name,
      volumes: parseResourceVolumes(resource.resource),
    }),
  );
}

async function listProjectRuntimeCleanupResources(
  environments: EnvironmentRow[],
): Promise<ProjectRuntimeCleanupResource[]> {
  const resources: ProjectRuntimeCleanupResource[] = [];
  for (const environment of environments) {
    const environmentResources: ProjectResourceRow[] = await listProjectResourcesByEnvironmentId(environment.id);
    resources.push(...buildEnvironmentCleanupResources(environment, environmentResources));
  }

  return resources;
}

function buildEnvironmentCleanupResources(
  environment: EnvironmentRow,
  resources: ProjectResourceRow[],
): ProjectRuntimeCleanupResource[] {
  return resources.map(
    (resource: ProjectResourceRow): ProjectRuntimeCleanupResource => ({
      environmentName: environment.name,
      resource,
    }),
  );
}

async function resolveProjectRuntimeNodes(environments: EnvironmentRow[]): Promise<NodeRow[]> {
  const nodeIds: string[] = [...new Set(environments.map((environment: EnvironmentRow): string => environment.nodeId))];
  const nodes: NodeRow[] = [];
  for (const nodeId of nodeIds) {
    nodes.push(await resolveProjectRuntimeNode(nodeId));
  }

  return nodes;
}

async function resolveProjectRuntimeNode(nodeId: string): Promise<NodeRow> {
  const node: NodeRow | undefined = await findNodeById(nodeId);
  if (node === undefined) {
    throw new Error('Project runtime node not found.');
  }

  return node;
}

async function markProjectRuntimeStopped(projectId: string, resources: ProjectRuntimeCleanupResource[]): Promise<void> {
  const updatedAt: Date = new Date();
  const deployments: DeploymentJoinedRow[] = await listActiveJoinedDeploymentsForProject(
    projectId,
    getApiConfig().baseDomain,
  );
  for (const deployment of deployments) {
    await markDeploymentStopped({
      deploymentId: deployment.deployment.id,
      updatedAt,
    });
  }
  for (const resource of resources) {
    await updateProjectResourceRuntime({
      containerId: null,
      projectResourceId: resource.resource.id,
      status: 'stopped',
      updatedAt,
    });
  }
}
