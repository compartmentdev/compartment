import { type AccessAssignmentScopeType } from '@compartment/contracts/browser';
import { type BrowserAccessAssignmentCreateScope } from '../../lib/access-assignment-browser';
import { type AccessScopeEnvironmentOption, parseScopeEnvironmentValue } from './access-scope-options';

export function readAccessAssignmentCreateScopes(
  scopeType: AccessAssignmentScopeType,
  projectNames: string[],
  environmentValues: string[],
): BrowserAccessAssignmentCreateScope[] {
  if (scopeType === 'organization') {
    return [{ scopeType: 'organization' }];
  }
  if (scopeType === 'project') {
    return projectNames.map(
      (projectName: string): BrowserAccessAssignmentCreateScope => ({ projectName, scopeType: 'project' }),
    );
  }

  return environmentValues.map((value: string): BrowserAccessAssignmentCreateScope => {
    const environmentScope: AccessScopeEnvironmentOption = parseScopeEnvironmentValue(value);
    return {
      environmentName: environmentScope.environmentName,
      projectName: environmentScope.projectName,
      scopeType: 'environment',
    };
  });
}
