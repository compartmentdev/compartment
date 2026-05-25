import {
  listAccessAssignmentScopeOptionRows,
  type AccessAssignmentScopeOptionRow,
} from '../queries/access-assignment-scope-options.query';
import type { AccessAssignmentScopeProjectResult } from './access-assignment-scope-options.service.types';

export async function listOrganizationAccessAssignmentScopeProjects(
  organizationId: string,
): Promise<AccessAssignmentScopeProjectResult[]> {
  const rows: AccessAssignmentScopeOptionRow[] = await listAccessAssignmentScopeOptionRows(organizationId);
  const projectsByName: Map<string, AccessAssignmentScopeProjectResult> = new Map<
    string,
    AccessAssignmentScopeProjectResult
  >();

  rows.forEach((row: AccessAssignmentScopeOptionRow): void => {
    const project: AccessAssignmentScopeProjectResult = readOrCreateScopeProject(projectsByName, row.projectName);
    if (row.environmentName !== null) {
      project.environmentNames.push(row.environmentName);
    }
  });

  return [...projectsByName.values()];
}

function readOrCreateScopeProject(
  projectsByName: Map<string, AccessAssignmentScopeProjectResult>,
  projectName: string,
): AccessAssignmentScopeProjectResult {
  const existing: AccessAssignmentScopeProjectResult | undefined = projectsByName.get(projectName);
  if (existing !== undefined) {
    return existing;
  }

  const created: AccessAssignmentScopeProjectResult = {
    environmentNames: [],
    projectName,
  };
  projectsByName.set(projectName, created);
  return created;
}
