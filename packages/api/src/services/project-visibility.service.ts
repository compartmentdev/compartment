import type { PermissionKey } from '@compartment/contracts';
import { createForbiddenError } from '../errors/api-business-error';
import { listProjectIdsByEnvironmentIds } from '../queries/access-scope.query';
import { listEnvironmentScopedAssignmentEnvironmentIds } from '../queries/rbac-assignments.query';
import type { ProjectRow } from '../queries/projects.query.types';
import { listPrincipalPermissionGrants, resolveInheritedAccessFromScopeChain } from './access-scope.service';
import type { AccessScopeReference, PrincipalPermissionGrant } from './access-scope.service.types';

export interface VisibleProjectSummary {
  hasEnvironmentVisibility: boolean;
  permissions: PermissionKey[];
  project: ProjectRow;
}

export async function requireVisibleProjectSummary(
  organizationId: string,
  principalId: string,
  project: ProjectRow,
): Promise<VisibleProjectSummary> {
  const [projectSummary] = await listVisibleProjectSummaries(organizationId, principalId, [project]);
  if (projectSummary === undefined) {
    throw createForbiddenError();
  }

  return projectSummary;
}

export async function listVisibleProjectSummaries(
  organizationId: string,
  principalId: string,
  projects: readonly ProjectRow[],
): Promise<VisibleProjectSummary[]> {
  if (projects.length === 0) {
    return [];
  }

  const [environmentVisibleProjectIds, grants]: [Set<string>, PrincipalPermissionGrant[]] = await Promise.all([
    readEnvironmentVisibleProjectIds(organizationId, principalId),
    listPrincipalPermissionGrants(organizationId, principalId),
  ]);

  return projects.flatMap((project: ProjectRow): VisibleProjectSummary[] => {
    const projectSummary: VisibleProjectSummary = buildVisibleProjectSummary(
      project,
      environmentVisibleProjectIds,
      grants,
    );
    return projectSummary.permissions.includes('project.read') || projectSummary.hasEnvironmentVisibility
      ? [projectSummary]
      : [];
  });
}

function buildVisibleProjectSummary(
  project: ProjectRow,
  environmentVisibleProjectIds: ReadonlySet<string>,
  grants: PrincipalPermissionGrant[],
): VisibleProjectSummary {
  const access: { permissions: PermissionKey[] } | null = resolveInheritedAccessFromScopeChain(
    buildProjectVisibilityScopeChain(project),
    grants,
  );

  return {
    hasEnvironmentVisibility: environmentVisibleProjectIds.has(project.id),
    permissions: access?.permissions ?? [],
    project,
  };
}

function buildProjectVisibilityScopeChain(project: ProjectRow): AccessScopeReference[] {
  return [
    { scopeId: project.id, scopeType: 'project' },
    { scopeId: project.organizationId, scopeType: 'organization' },
  ];
}

async function readEnvironmentVisibleProjectIds(organizationId: string, principalId: string): Promise<Set<string>> {
  return new Set<string>(
    await listProjectIdsByEnvironmentIds(
      await listEnvironmentScopedAssignmentEnvironmentIds(organizationId, principalId),
    ),
  );
}
