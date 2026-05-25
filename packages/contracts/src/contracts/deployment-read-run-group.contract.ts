import type { DeploymentReadSummary } from './deployment-read.contract';
import type { DeploymentRuntimeStatus } from './deployments.contract';

export interface DeploymentReadRunGroup {
  completedAt: string | null;
  createdAt: string;
  deploymentCount: number;
  deploymentRunId: string;
  deployments: DeploymentReadSummary[];
  failureMessage: string | null;
  label: string;
  status: DeploymentRuntimeStatus;
}

export function buildDeploymentReadRunGroups(deployments: readonly DeploymentReadSummary[]): DeploymentReadRunGroup[] {
  const groupsByRunId: Map<string, DeploymentReadSummary[]> = new Map<string, DeploymentReadSummary[]>();

  for (const deployment of deployments) {
    const existingDeployments: DeploymentReadSummary[] | undefined = groupsByRunId.get(deployment.deploymentRunId);
    if (existingDeployments === undefined) {
      groupsByRunId.set(deployment.deploymentRunId, [deployment]);
      continue;
    }

    existingDeployments.push(deployment);
  }

  return [...groupsByRunId.entries()].map(
    ([deploymentRunId, runDeployments]: [string, DeploymentReadSummary[]]): DeploymentReadRunGroup =>
      buildDeploymentReadRunGroup(deploymentRunId, runDeployments),
  );
}

function buildDeploymentReadRunGroup(
  deploymentRunId: string,
  deployments: readonly DeploymentReadSummary[],
): DeploymentReadRunGroup {
  const sortedDeployments: DeploymentReadSummary[] = [...deployments].sort(
    (left: DeploymentReadSummary, right: DeploymentReadSummary): number =>
      left.serviceName.localeCompare(right.serviceName),
  );

  return {
    completedAt: readRunCompletedAt(deployments),
    createdAt: readRunCreatedAt(deployments),
    deploymentCount: deployments.length,
    deploymentRunId,
    deployments: sortedDeployments,
    failureMessage: readRunFailureMessage(deployments),
    label: readRunLabel(deployments),
    status: readDeploymentReadRunStatus(deployments),
  };
}

function readRunCreatedAt(deployments: readonly DeploymentReadSummary[]): string {
  return deployments.reduce(
    (earliestCreatedAt: string, deployment: DeploymentReadSummary): string =>
      deployment.createdAt < earliestCreatedAt ? deployment.createdAt : earliestCreatedAt,
    deployments[0]!.createdAt,
  );
}

function readRunCompletedAt(deployments: readonly DeploymentReadSummary[]): string | null {
  let latestCompletedAt: string | null = null;
  for (const deployment of deployments) {
    if (deployment.completedAt === null) {
      return null;
    }

    if (latestCompletedAt === null || deployment.completedAt > latestCompletedAt) {
      latestCompletedAt = deployment.completedAt;
    }
  }

  return latestCompletedAt;
}

function readRunFailureMessage(deployments: readonly DeploymentReadSummary[]): string | null {
  for (const deployment of deployments) {
    if (deployment.failureMessage !== null) {
      return deployment.failureMessage;
    }
  }

  return null;
}

function readRunLabel(deployments: readonly DeploymentReadSummary[]): string {
  for (const deployment of deployments) {
    if (deployment.label !== null) {
      return deployment.label;
    }
  }

  return deployments[0]!.operation.type;
}

export function readDeploymentReadRunStatus(deployments: readonly DeploymentReadSummary[]): DeploymentRuntimeStatus {
  if (deployments.some((deployment: DeploymentReadSummary): boolean => deployment.status === 'failed')) {
    return 'failed';
  }

  if (deployments.some((deployment: DeploymentReadSummary): boolean => deployment.status === 'running')) {
    return 'running';
  }

  if (deployments.some((deployment: DeploymentReadSummary): boolean => deployment.status === 'queued')) {
    return 'queued';
  }

  if (deployments.some((deployment: DeploymentReadSummary): boolean => deployment.status === 'stopped')) {
    return 'stopped';
  }

  return 'succeeded';
}
