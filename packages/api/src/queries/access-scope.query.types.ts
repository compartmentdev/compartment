export interface EnvironmentScopeLookupRow {
  id: string;
  name: string;
  organizationId: string;
  projectId: string;
  projectName: string;
}

export interface EnvironmentScopeTargetRow {
  environmentName: string;
  projectName: string;
  scopeId: string;
}

export interface ProjectScopeLookupRow {
  id: string;
  name: string;
  organizationId: string;
}

export interface ProjectEnvironmentScopeLookupRow {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}

export interface ProjectScopeTargetRow {
  projectName: string;
  scopeId: string;
}
