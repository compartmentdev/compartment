import type { ProjectNetworkPolicyPorts } from '@compartment/contracts';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { deploymentKubeReferences, deployments, environments, projectResources } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';

interface PersistedPortList {
  portsJson: string;
}

export async function readProjectNetworkPolicyPorts(
  projectId: string,
  excludedDeploymentId: string | null,
): Promise<ProjectNetworkPolicyPorts> {
  const [applicationRows, resourceRows]: [PersistedPortList[], PersistedPortList[]] = await Promise.all([
    readApplicationPorts(projectId, excludedDeploymentId),
    readResourcePorts(projectId),
  ]);
  return {
    applicationPorts: unionPorts(applicationRows),
    resourcePorts: unionPorts(resourceRows),
  };
}

async function readApplicationPorts(
  projectId: string,
  excludedDeploymentId: string | null,
): Promise<PersistedPortList[]> {
  return await getApiDatabase()
    .select({ portsJson: deployments.resolvedPortsJson })
    .from(deploymentKubeReferences)
    .innerJoin(deployments, eq(deployments.id, deploymentKubeReferences.deploymentId))
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(
      and(
        eq(environments.projectId, projectId),
        inArray(deploymentKubeReferences.state, ['active', 'desired', 'pending']),
        excludedDeploymentId === null ? undefined : ne(deployments.id, excludedDeploymentId),
      ),
    );
}

async function readResourcePorts(projectId: string): Promise<PersistedPortList[]> {
  return await getApiDatabase()
    .select({ portsJson: projectResources.portsJson })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .where(and(eq(environments.projectId, projectId), ne(projectResources.status, 'deleting')));
}

function unionPorts(rows: PersistedPortList[]): number[] {
  return [...new Set(rows.flatMap((row: PersistedPortList): number[] => JSON.parse(row.portsJson) as number[]))].sort(
    (left: number, right: number): number => left - right,
  );
}
