import { and, asc, eq, isNull } from 'drizzle-orm';
import { projectKubeProvisioning, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { ProvisionedProjectNamespaceRow } from './pod-metric-namespaces.query.types';
import { projectIsolationVersion } from './project-provisioning-policy';

export async function listProvisionedProjectNamespaceRows(): Promise<ProvisionedProjectNamespaceRow[]> {
  return await getApiDatabase()
    .select({ projectId: projectKubeProvisioning.projectId })
    .from(projectKubeProvisioning)
    .innerJoin(projects, eq(projects.id, projectKubeProvisioning.projectId))
    .where(
      and(
        eq(projectKubeProvisioning.state, 'succeeded'),
        eq(projectKubeProvisioning.isolationVersion, projectIsolationVersion),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(projectKubeProvisioning.projectId));
}
