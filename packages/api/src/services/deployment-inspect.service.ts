import type {
  NodeInspectDeploymentQuery,
  NodeInspectDeploymentResponse,
  NodeInspectedDeployment,
} from '@compartment/contracts';
import { inspectNodeDeployment } from '@compartment/sdk';
import { findNodeById } from '../queries/node.query';
import type { NodeRow } from '../queries/node.query.types';
import { requireNode } from './deployment-context.service';
import type {
  DeploymentInspectLookupResult,
  DeploymentInspectTargetResult,
  DeploymentStatusLookupResult,
  StatusLookupInput,
} from './deployments.service.types';
import { getDeploymentStatusSummary } from './deployment-status.service';
import { createNodeRuntimeRequester } from './node-runtime-requester';
import type { DeploymentSummaryInput } from './presenter.types';

export async function getDeploymentInspectSummary(input: StatusLookupInput): Promise<DeploymentInspectLookupResult> {
  const status: DeploymentStatusLookupResult = await getDeploymentStatusSummary(input, 'deployment.inspect');
  const deployments: DeploymentInspectTargetResult[] = await enrichInspectTargets(status.deployments);
  const activeDeployments: DeploymentInspectTargetResult[] = await enrichInspectTargets(status.activeDeployments);

  return {
    activeDeployments,
    deployments,
    environment: status.environment,
    project: status.project,
  };
}

async function enrichInspectTargets(deployments: DeploymentSummaryInput[]): Promise<DeploymentInspectTargetResult[]> {
  return await Promise.all(
    deployments.map(
      async (deployment: DeploymentSummaryInput): Promise<DeploymentInspectTargetResult> =>
        await enrichInspectTarget(deployment),
    ),
  );
}

async function enrichInspectTarget(deployment: DeploymentSummaryInput): Promise<DeploymentInspectTargetResult> {
  return {
    ...deployment,
    runtime: await resolveRuntimeDeployment(deployment),
  };
}

async function resolveRuntimeDeployment(deployment: DeploymentSummaryInput): Promise<NodeInspectedDeployment | null> {
  if (deployment.deployment.containerId === null) {
    return null;
  }

  const node: NodeRow = requireNode(await findNodeById(deployment.deployment.nodeId));
  const query: NodeInspectDeploymentQuery = {
    deploymentId: deployment.deployment.id,
    environmentName: deployment.environment.name,
    projectName: deployment.project.name,
    serviceName: deployment.service.name,
  };
  const runtime: NodeInspectDeploymentResponse = await inspectNodeDeployment(
    createNodeRuntimeRequester(node.nodeSocketPath),
    query,
  );

  return runtime.deployment;
}
