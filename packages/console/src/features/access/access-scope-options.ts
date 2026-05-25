import type { AccessAssignmentScopeProjectOption } from '@compartment/contracts/browser';

export interface AccessScopeEnvironmentOption {
  environmentName: string;
  label: string;
  projectName: string;
  value: string;
}

const scopeEnvironmentValueSeparator: string = '::';

export function readValidScopeProjectNames(
  scopeProjects: AccessAssignmentScopeProjectOption[],
  projectNames: string[],
): string[] {
  const validProjectNames: Set<string> = new Set<string>(readScopeProjectNames(scopeProjects));
  return projectNames.filter((projectName: string): boolean => validProjectNames.has(projectName));
}

export function readScopeProjectNames(scopeProjects: AccessAssignmentScopeProjectOption[]): string[] {
  return scopeProjects.map((project: AccessAssignmentScopeProjectOption): string => project.projectName);
}

export function readValidScopeEnvironmentValues(
  scopeProjects: AccessAssignmentScopeProjectOption[],
  projectNames: string[],
  values: string[],
): string[] {
  const validValues: Set<string> = new Set<string>(
    readScopeEnvironmentOptions(scopeProjects, projectNames).map(
      (option: AccessScopeEnvironmentOption): string => option.value,
    ),
  );

  return values.filter((value: string): boolean => validValues.has(value));
}

export function readScopeEnvironmentOptions(
  scopeProjects: AccessAssignmentScopeProjectOption[],
  projectNames: string[],
): AccessScopeEnvironmentOption[] {
  return projectNames.flatMap((projectName: string): AccessScopeEnvironmentOption[] =>
    readScopeEnvironmentNames(scopeProjects, projectName).map(
      (environmentName: string): AccessScopeEnvironmentOption => ({
        environmentName,
        label: `${projectName} / ${environmentName}`,
        projectName,
        value: buildScopeEnvironmentValue(projectName, environmentName),
      }),
    ),
  );
}

function readScopeEnvironmentNames(scopeProjects: AccessAssignmentScopeProjectOption[], projectName: string): string[] {
  return (
    scopeProjects.find((project: AccessAssignmentScopeProjectOption): boolean => project.projectName === projectName)
      ?.environmentNames ?? []
  );
}

function buildScopeEnvironmentValue(projectName: string, environmentName: string): string {
  return `${projectName}${scopeEnvironmentValueSeparator}${environmentName}`;
}

export function parseScopeEnvironmentValue(value: string): AccessScopeEnvironmentOption {
  const [projectName = '', environmentName = ''] = value.split(scopeEnvironmentValueSeparator);

  return {
    environmentName,
    label: `${projectName} / ${environmentName}`,
    projectName,
    value,
  };
}
