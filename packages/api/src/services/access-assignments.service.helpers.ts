import type { AccessAssignmentScopeTarget, PermissionKey } from '@compartment/contracts';
import { listEnvironmentScopeTargetsByIds, listProjectScopeTargetsByIds } from '../queries/access-scope.query';
import type { EnvironmentScopeTargetRow, ProjectScopeTargetRow } from '../queries/access-scope.query.types';
import type { AccessAssignmentSummaryRow, AccessRoleRow } from '../queries/rbac.query.types';
import type {
  AccessAssignmentResult,
  AccessAssignmentScopeResult,
  AccessAssignmentSubjectResult,
} from './access-assignments.service.types';
import { readAccessScopeIds, toScopeKey, type AccessScopeIds } from './access-scope-keys.service.helpers';

type AssignmentScopeTargetByKey = ReadonlyMap<string, AccessAssignmentScopeTarget>;

export function buildCreatedAccessAssignmentResult(input: {
  assignment: { createdAt: Date; id: string };
  role: AccessRoleRow;
  scope: AccessAssignmentScopeTarget;
  subject: AccessAssignmentSubjectResult;
}): AccessAssignmentResult {
  return {
    createdAt: input.assignment.createdAt.toISOString(),
    id: input.assignment.id,
    roleId: input.role.id,
    roleKind: input.role.kind,
    roleName: input.role.name,
    scope: toAccessAssignmentScopeResult(input.scope),
    subject: input.subject,
  };
}

export async function toAccessAssignmentResults(rows: AccessAssignmentSummaryRow[]): Promise<AccessAssignmentResult[]> {
  const scopeTargetByKey: AssignmentScopeTargetByKey = await buildAssignmentScopeTargetByKey(rows);
  const results: AccessAssignmentResult[] = [];
  for (const row of rows) {
    const scope: AccessAssignmentScopeTarget | undefined = scopeTargetByKey.get(toAssignmentScopeKey(row));
    if (scope === undefined) {
      continue;
    }
    results.push(toAccessAssignmentResult(row, scope));
  }

  return results;
}

export function listEffectivePermissions(permissionKeys: PermissionKey[]): PermissionKey[] {
  return [...new Set(permissionKeys)].sort((left: string, right: string): number => left.localeCompare(right));
}

function toAccessAssignmentResult(
  row: AccessAssignmentSummaryRow,
  scope: AccessAssignmentScopeTarget,
): AccessAssignmentResult {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    roleId: row.roleId,
    roleKind: row.roleKind,
    roleName: row.roleName,
    scope: toAccessAssignmentScopeResult(scope),
    subject: toAccessAssignmentSubjectResult(row),
  };
}

async function buildAssignmentScopeTargetByKey(
  rows: readonly AccessAssignmentSummaryRow[],
): Promise<AssignmentScopeTargetByKey> {
  const scopeIds: AccessScopeIds = readAccessScopeIds(rows);
  const [projects, environments]: [ProjectScopeTargetRow[], EnvironmentScopeTargetRow[]] = await Promise.all([
    listProjectScopeTargetsByIds(scopeIds.projectIds),
    listEnvironmentScopeTargetsByIds(scopeIds.environmentIds),
  ]);
  const scopeTargetByKey: Map<string, AccessAssignmentScopeTarget> = new Map<string, AccessAssignmentScopeTarget>();
  addOrganizationScopeTargets(scopeTargetByKey, rows);
  addProjectScopeTargets(scopeTargetByKey, projects);
  addEnvironmentScopeTargets(scopeTargetByKey, environments);
  return scopeTargetByKey;
}

function addOrganizationScopeTargets(
  scopeTargetByKey: Map<string, AccessAssignmentScopeTarget>,
  rows: readonly AccessAssignmentSummaryRow[],
): void {
  for (const row of rows) {
    if (row.scopeType === 'organization') {
      scopeTargetByKey.set(toAssignmentScopeKey(row), { scopeType: 'organization' });
    }
  }
}

function addProjectScopeTargets(
  scopeTargetByKey: Map<string, AccessAssignmentScopeTarget>,
  projects: readonly ProjectScopeTargetRow[],
): void {
  for (const project of projects) {
    scopeTargetByKey.set(toScopeKey('project', project.scopeId), {
      projectName: project.projectName,
      scopeType: 'project',
    });
  }
}

function addEnvironmentScopeTargets(
  scopeTargetByKey: Map<string, AccessAssignmentScopeTarget>,
  environments: readonly EnvironmentScopeTargetRow[],
): void {
  for (const environment of environments) {
    scopeTargetByKey.set(toScopeKey('environment', environment.scopeId), {
      environmentName: environment.environmentName,
      projectName: environment.projectName,
      scopeType: 'environment',
    });
  }
}

function toAssignmentScopeKey(row: AccessAssignmentSummaryRow): string {
  return toScopeKey(row.scopeType, row.scopeId);
}

function toAccessAssignmentScopeResult(scope: AccessAssignmentScopeTarget): AccessAssignmentScopeResult {
  if (scope.scopeType === 'organization') {
    return { scopeType: scope.scopeType };
  }

  if (scope.scopeType === 'project') {
    const { projectName, scopeType } = scope;
    return { projectName, scopeType };
  }

  const { environmentName, projectName, scopeType } = scope;
  return { environmentName, projectName, scopeType };
}

function toAccessAssignmentSubjectResult(row: AccessAssignmentSummaryRow): AccessAssignmentSubjectResult {
  if (row.subjectType === 'group') {
    return {
      groupId: row.groupId,
      groupName: row.groupName,
      subjectType: 'group',
    };
  }

  return {
    principalEmail: row.principalEmail,
    subjectType: 'principal',
  };
}
