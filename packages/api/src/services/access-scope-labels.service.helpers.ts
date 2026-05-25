import { listEnvironmentScopeTargetsByIds, listProjectScopeTargetsByIds } from '../queries/access-scope.query';
import type { AccessAssignmentScopeTypeValue } from '../queries/rbac.query.types';
import { readAccessScopeIds, toScopeKey, type AccessScopeIds } from './access-scope-keys.service.helpers';

interface ScopeLabelRow {
  scopeId: string;
  scopeType: AccessAssignmentScopeTypeValue;
}

export async function buildScopeLabelByScopeKey(rows: readonly ScopeLabelRow[]): Promise<ReadonlyMap<string, string>> {
  const scopeIds: AccessScopeIds = readAccessScopeIds(rows);
  const labelByScopeKey: Map<string, string> = new Map<string, string>();
  addProjectScopeLabels(labelByScopeKey, await listProjectScopeTargetsByIds(scopeIds.projectIds));
  addEnvironmentScopeLabels(labelByScopeKey, await listEnvironmentScopeTargetsByIds(scopeIds.environmentIds));
  return labelByScopeKey;
}

function addProjectScopeLabels(
  labelByScopeKey: Map<string, string>,
  projects: readonly { projectName: string; scopeId: string }[],
): void {
  for (const project of projects) {
    labelByScopeKey.set(toScopeKey('project', project.scopeId), project.projectName);
  }
}

function addEnvironmentScopeLabels(
  labelByScopeKey: Map<string, string>,
  environments: readonly { environmentName: string; projectName: string; scopeId: string }[],
): void {
  for (const environment of environments) {
    labelByScopeKey.set(
      toScopeKey('environment', environment.scopeId),
      `${environment.projectName} / ${environment.environmentName}`,
    );
  }
}

export { toScopeKey };
