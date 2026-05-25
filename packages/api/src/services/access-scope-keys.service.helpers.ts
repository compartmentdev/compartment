import type { AccessAssignmentScopeTypeValue } from '../queries/rbac.query.types';

export interface AccessScopeIds {
  environmentIds: string[];
  projectIds: string[];
}

interface AccessScopeRow {
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export function readAccessScopeIds(rows: readonly AccessScopeRow[]): AccessScopeIds {
  const environmentIds: string[] = [];
  const projectIds: string[] = [];

  for (const row of rows) {
    if (row.scopeType === 'project') {
      projectIds.push(row.scopeId);
    }
    if (row.scopeType === 'environment') {
      environmentIds.push(row.scopeId);
    }
  }

  return {
    environmentIds: [...new Set(environmentIds)],
    projectIds: [...new Set(projectIds)],
  };
}

export function toScopeKey(scopeType: AccessAssignmentScopeTypeValue, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}
