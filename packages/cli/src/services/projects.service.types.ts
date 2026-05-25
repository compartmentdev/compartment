import type { StoredProjectDescriptor } from './project-descriptor.types';

export interface ProjectScopeInput {
  cwd: string;
  projectName?: string | undefined;
}

export interface ProjectListInput {
  includeArchived: boolean;
  includeOverview: boolean;
  page: number;
  perPage: number;
}

export interface RenameProjectInput extends ProjectScopeInput {
  nextProjectName: string;
}

export interface ProjectLifecycleInput extends ProjectScopeInput {
  environmentName?: string | undefined;
}

export interface ResolvedProjectTarget {
  descriptor?: StoredProjectDescriptor | undefined;
  projectName: string;
  updatesLocalDescriptor: boolean;
}
