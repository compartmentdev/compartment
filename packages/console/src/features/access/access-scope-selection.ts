import type { AccessAssignmentScopeProjectOption } from '@compartment/contracts/browser';
import { readValidScopeEnvironmentValues, readValidScopeProjectNames } from './access-scope-options';

interface AccessScopeSelectionSyncInput {
  environmentValues: string[];
  projectNames: string[];
  scopeProjects: AccessAssignmentScopeProjectOption[];
  setEnvironmentValues: (value: string[]) => void;
  setProjectNames: (value: string[]) => void;
}

export function syncAccessScopeSelections(input: Readonly<AccessScopeSelectionSyncInput>): void {
  const nextProjectNames: string[] = readValidScopeProjectNames(input.scopeProjects, input.projectNames);
  if (nextProjectNames.length !== input.projectNames.length) {
    input.setProjectNames(nextProjectNames);
  }

  const nextEnvironmentValues: string[] = readValidScopeEnvironmentValues(
    input.scopeProjects,
    nextProjectNames,
    input.environmentValues,
  );
  if (nextEnvironmentValues.length !== input.environmentValues.length) {
    input.setEnvironmentValues(nextEnvironmentValues);
  }
}
