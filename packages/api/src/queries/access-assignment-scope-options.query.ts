import { asc, eq } from 'drizzle-orm';
import { environments, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';

export interface AccessAssignmentScopeOptionRow {
  environmentName: string | null;
  projectName: string;
}

export async function listAccessAssignmentScopeOptionRows(
  organizationId: string,
): Promise<AccessAssignmentScopeOptionRow[]> {
  return await getApiDatabase()
    .select({
      environmentName: environments.name,
      projectName: projects.name,
    })
    .from(projects)
    .leftJoin(environments, eq(environments.projectId, projects.id))
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.name), asc(environments.name));
}
