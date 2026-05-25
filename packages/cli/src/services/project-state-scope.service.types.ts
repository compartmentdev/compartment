import type { StoredProjectState } from '../store/project-state.types';

export interface StoredProjectStateReference {
  filePath: string;
  root: string;
  state: StoredProjectState;
}

export interface ProjectStateScope {
  effectiveState?: StoredProjectStateReference | undefined;
  gitRoot?: string | undefined;
  projectRoot?: string | undefined;
  projectState?: StoredProjectStateReference | undefined;
  repoState?: StoredProjectStateReference | undefined;
}
