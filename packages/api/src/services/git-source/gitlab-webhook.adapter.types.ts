export interface GitLabPushCommit {
  added?: string[] | undefined;
  modified?: string[] | undefined;
  removed?: string[] | undefined;
}

export interface GitLabPushProject {
  id: number;
  path_with_namespace?: string | undefined;
}

export interface GitLabPushPayload {
  checkout_sha: string | null;
  commits: GitLabPushCommit[];
  object_kind: 'push';
  project: GitLabPushProject;
  ref: string;
  total_commits_count?: number | undefined;
}

export interface ParsedGitLabPush {
  branchName: string;
  changedFiles: string[];
  changedFilesComplete: boolean;
  commitSha: string;
  repositoryExternalId: string;
}
