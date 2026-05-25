import type { GitHubRepositoryPullRequestState } from './github-app-client.adapter.types';

export function readGitHubPullRequestState(value: string | undefined): GitHubRepositoryPullRequestState {
  if (value === 'closed' || value === 'open') {
    return value;
  }

  throw new Error(`Unsupported GitHub pull request state ${value ?? '<missing>'}.`);
}
