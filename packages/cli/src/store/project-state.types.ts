export interface StoredProjectState {
  selectedRemote?: string | undefined;
}

export interface ProjectStateGitIgnoreWritePlan {
  entry: string;
  filePath: string;
  repositoryRoot: string;
}

export interface ProjectStateWritePlan {
  filePath: string;
  gitIgnorePlan?: ProjectStateGitIgnoreWritePlan | undefined;
  repositoryRoot: string;
}
