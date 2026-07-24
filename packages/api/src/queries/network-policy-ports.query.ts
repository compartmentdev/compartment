import type { ProjectNetworkPolicyPorts } from '@compartment/contracts';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { deploymentKubeReferences, deployments, environments, projectResources } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';

interface PersistedPortList {
  portsJson: string;
}

export async function readProjectNetworkPolicyPorts(projectId: string): Promise<ProjectNetworkPolicyPorts> {
  const [applicationRows, resourceRows]: [PersistedPortList[], PersistedPortList[]] = await Promise.all([
    getApiDatabase()
      .select({ portsJson: deployments.resolvedPortsJson })
      .from(deploymentKubeReferences)
      .innerJoin(deployments, eq(deployments.id, deploymentKubeReferences.deploymentId))
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .where(
        and(
          eq(environments.projectId, projectId),
          inArray(deploymentKubeReferences.state, ['active', 'desired', 'pending']),
        ),
      ),
    getApiDatabase()
      .select({ portsJson: projectResources.portsJson })
      .from(projectResources)
      .innerJoin(environments, eq(environments.id, projectResources.environmentId))
      .where(and(eq(environments.projectId, projectId), ne(projectResources.status, 'deleting'))),
  ]);
  return {
    applicationPorts: unionPorts(applicationRows),
    resourcePorts: unionPorts(resourceRows),
  };
}

function unionPorts(rows: PersistedPortList[]): number[] {
  return [...new Set(rows.flatMap((row: PersistedPortList): number[] => JSON.parse(row.portsJson) as number[]))].sort(
    (left: number, right: number): number => left - right,
  );
}
