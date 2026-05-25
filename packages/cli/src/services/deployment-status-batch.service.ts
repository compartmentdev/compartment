import type { DeploymentReadSummary, DeploymentStatusResponse, DeploymentSummary } from '@compartment/contracts';

type ExpectedDeployment = Pick<DeploymentSummary, 'id' | 'serviceName'>;

export function ensurePolledDeployments(statuses: DeploymentStatusResponse[], deployments: ExpectedDeployment[]): void {
  for (const [index, deployment] of deployments.entries()) {
    if (statuses[index]?.deployments[0] === undefined) {
      throw new Error(`Deployment ${deployment.id} was not found while polling.`);
    }
  }
}

export function buildAggregatedDeploymentStatus(
  statuses: DeploymentStatusResponse[],
  expectedDeployments: ExpectedDeployment[],
): DeploymentStatusResponse {
  const deployments: DeploymentReadSummary[] = readOrderedDeployments(statuses, expectedDeployments);
  const activeDeployments: DeploymentReadSummary[] = readOrderedActiveDeployments(statuses, expectedDeployments);
  const firstStatus: DeploymentStatusResponse | undefined = statuses[0];
  if (firstStatus === undefined) {
    throw new Error('Expected at least one deployment status while polling.');
  }

  return {
    activeDeployments,
    deployments,
    environment: firstStatus.environment,
    project: firstStatus.project,
  };
}

export function throwIfDeploymentBatchFailed(statuses: DeploymentStatusResponse[]): void {
  const failedDeployment: DeploymentReadSummary | null = readFailedDeployment(statuses);
  if (failedDeployment !== null) {
    throw new Error(failedDeployment.failureMessage ?? `Deployment ${failedDeployment.id} failed.`);
  }
}

export function isCompletedDeploymentStatus(status: DeploymentStatusResponse): boolean {
  const deployment: DeploymentReadSummary = readRequiredPolledDeployment(status);
  return (
    (deployment.status === 'succeeded' &&
      (deployment.promotionStage === 'active' || deployment.promotionStage === 'rolled_back')) ||
    (deployment.status === 'stopped' && deployment.promotionStage === 'stopped')
  );
}

function readFailedDeployment(statuses: DeploymentStatusResponse[]): DeploymentReadSummary | null {
  for (const status of statuses) {
    const deployment: DeploymentReadSummary = readRequiredPolledDeployment(status);
    if (deployment.status === 'failed') {
      return deployment;
    }
  }

  return null;
}

function readOrderedDeployments(
  statuses: DeploymentStatusResponse[],
  expectedDeployments: ExpectedDeployment[],
): DeploymentReadSummary[] {
  const deploymentsById: Map<string, DeploymentReadSummary> = new Map<string, DeploymentReadSummary>(
    statuses.map((status: DeploymentStatusResponse): [string, DeploymentReadSummary] => {
      const deployment: DeploymentReadSummary = readRequiredPolledDeployment(status);

      return [deployment.id, deployment];
    }),
  );

  return expectedDeployments.map(
    (deployment: ExpectedDeployment): DeploymentReadSummary =>
      requireOrderedDeployment(deploymentsById.get(deployment.id), deployment.id),
  );
}

function readOrderedActiveDeployments(
  statuses: DeploymentStatusResponse[],
  expectedDeployments: ExpectedDeployment[],
): DeploymentReadSummary[] {
  const activeDeploymentsByServiceName: Map<string, DeploymentReadSummary> = new Map<string, DeploymentReadSummary>(
    statuses.flatMap((status: DeploymentStatusResponse): [string, DeploymentReadSummary][] =>
      status.activeDeployments.map((deployment: DeploymentReadSummary): [string, DeploymentReadSummary] => [
        deployment.serviceName,
        deployment,
      ]),
    ),
  );

  return expectedDeployments.flatMap((deployment: ExpectedDeployment): DeploymentReadSummary[] => {
    const activeDeployment: DeploymentReadSummary | undefined = activeDeploymentsByServiceName.get(
      deployment.serviceName,
    );

    return activeDeployment !== undefined ? [activeDeployment] : [];
  });
}

function readRequiredPolledDeployment(status: DeploymentStatusResponse): DeploymentReadSummary {
  const deployment: DeploymentReadSummary | undefined = status.deployments[0];
  if (deployment === undefined) {
    throw new Error('Expected a deployment while polling.');
  }

  return deployment;
}

function requireOrderedDeployment(
  deployment: DeploymentReadSummary | undefined,
  deploymentId: string,
): DeploymentReadSummary {
  if (deployment === undefined) {
    throw new Error(`Deployment ${deploymentId} was not found while polling.`);
  }

  return deployment;
}
