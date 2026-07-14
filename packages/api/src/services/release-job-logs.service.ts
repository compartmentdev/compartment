import type { DeploymentLogLine, WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import { readProductJobResult } from '../queries/product-job-runs.query';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';

export async function collectReleaseJobLogLines(
  deployments: DeploymentJoinedRow[],
  environmentName: string,
  sinceDate: Date | undefined,
): Promise<DeploymentLogLine[]> {
  const groups: DeploymentLogLine[][] = await Promise.all(
    deployments.map(
      async (deployment: DeploymentJoinedRow): Promise<DeploymentLogLine[]> =>
        await resolveReleaseJobLogLines(deployment, environmentName, sinceDate),
    ),
  );
  return groups.flat();
}

async function resolveReleaseJobLogLines(
  deployment: DeploymentJoinedRow,
  environmentName: string,
  sinceDate: Date | undefined,
): Promise<DeploymentLogLine[]> {
  const deploymentId: string = deployment.deployment.id;
  const result: WorkerPersistProductJobResultRequest | null = await readProductJobResult('release', deploymentId);
  if (result === null || (sinceDate !== undefined && new Date(result.completedAt) < sinceDate)) {
    return [];
  }
  return result.logs
    .split('\n')
    .filter((message: string): boolean => message !== '')
    .map(
      (message: string): DeploymentLogLine => ({
        deploymentId,
        environmentName,
        message,
        serviceName: deployment.service.name,
        stream: 'stdout',
        timestamp: result.completedAt,
      }),
    );
}
