import type { Octokit } from '@octokit/rest';
import type {
  GitHubInstallationRepository,
  GitHubRepositoryBranchInput,
  GitHubRepositoryContent,
  GitHubRepositoryPullRequestStatusInput,
  GitHubRepositoryPullRequestStatus,
  GitHubRepositoryTreeEntry,
} from './github-app-client.adapter.types';
import { type GitHubApiResponse, createGitHubInstallationOctokit, requireGitHubField } from './github-app-http.adapter';
import { readGitHubPullRequestState } from './github-app-pull-request-state.adapter';

export { createGitHubRepositoryDescriptorPullRequest } from './github-app-repository-pr.adapter';

interface GitHubRepositoryApiResponse {
  default_branch?: string;
  id?: number;
  name?: string;
  owner?: {
    login?: string;
  };
  private?: boolean;
}

interface GitHubInstallationRepositoriesApiResponse {
  repositories?: GitHubRepositoryApiResponse[];
}

interface GitHubPaginatedApiResponse<TData> extends GitHubApiResponse<TData> {
  headers: {
    link?: string | undefined;
  };
}

interface GitHubRepositoryContentApiResponse {
  content?: string | undefined;
  encoding?: string | undefined;
  sha?: string | undefined;
  type?: string | undefined;
}

interface GitHubRepositoryTreeApiEntry {
  path?: string | undefined;
  type?: string | undefined;
}

interface GitHubRepositoryTreeApiResponse {
  tree: GitHubRepositoryTreeApiEntry[];
  truncated?: boolean | undefined;
}

export async function listGitHubInstallationRepositories(input: {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  providerHost: string;
}): Promise<GitHubInstallationRepository[]> {
  const octokit: Octokit = createGitHubInstallationOctokit(input);
  const repositories: GitHubRepositoryApiResponse[] = [];
  let page: number = 1;

  for (;;) {
    const response: GitHubPaginatedApiResponse<GitHubInstallationRepositoriesApiResponse> =
      await octokit.rest.apps.listReposAccessibleToInstallation({
        page,
        per_page: 100,
      });

    repositories.push(...(response.data.repositories ?? []));

    if (!hasNextGitHubPage(response.headers.link)) {
      return repositories.map(toGitHubInstallationRepository);
    }

    page += 1;
  }
}

function hasNextGitHubPage(linkHeader: string | undefined): boolean {
  return (
    linkHeader
      ?.split(',')
      .some((link: string): boolean => link.includes('rel="next"') || link.includes("rel='next'")) === true
  );
}

export async function assertGitHubRepositoryBranchExists(input: GitHubRepositoryBranchInput): Promise<void> {
  const octokit: Octokit = createGitHubInstallationOctokit(input);
  await octokit.rest.git.getRef({
    owner: input.owner,
    ref: `heads/${input.branchName}`,
    repo: input.repositoryName,
  });
}

export async function readGitHubRepositoryTree(input: {
  appId: string;
  branchName: string;
  installationId: string;
  owner: string;
  privateKeyPem: string;
  providerHost: string;
  repositoryName: string;
}): Promise<GitHubRepositoryTreeEntry[]> {
  const octokit: Octokit = createGitHubInstallationOctokit(input);
  const response: GitHubApiResponse<GitHubRepositoryTreeApiResponse> = await octokit.rest.git.getTree({
    owner: input.owner,
    recursive: 'true',
    repo: input.repositoryName,
    tree_sha: input.branchName,
  });

  if (response.data.truncated === true) {
    throw new Error(
      `GitHub repository tree for ${input.owner}/${input.repositoryName}@${input.branchName} is truncated.`,
    );
  }

  return response.data.tree.flatMap(toGitHubRepositoryTreeEntry);
}

export async function readGitHubRepositoryContent(input: {
  appId: string;
  branchName: string;
  installationId: string;
  owner: string;
  path: string;
  privateKeyPem: string;
  providerHost: string;
  repositoryName: string;
}): Promise<GitHubRepositoryContent> {
  const octokit: Octokit = createGitHubInstallationOctokit(input);
  const response: GitHubApiResponse<GitHubRepositoryContentApiResponse | GitHubRepositoryContentApiResponse[]> =
    await octokit.rest.repos.getContent({
      owner: input.owner,
      path: input.path,
      ref: input.branchName,
      repo: input.repositoryName,
    });

  return decodeGitHubRepositoryContent(input.path, response.data);
}

export async function readGitHubRepositoryPullRequestStatus(
  input: GitHubRepositoryPullRequestStatusInput,
): Promise<GitHubRepositoryPullRequestStatus> {
  const octokit: Octokit = createGitHubInstallationOctokit(input);
  const response: GitHubApiResponse<{
    html_url?: string | undefined;
    merged?: boolean | null | undefined;
    state?: string | undefined;
  }> = await octokit.rest.pulls.get({
    owner: input.owner,
    pull_number: input.pullRequestNumber,
    repo: input.repositoryName,
  });

  return {
    htmlUrl: requireGitHubField(response.data.html_url, 'html_url'),
    merged: response.data.merged === true,
    state: readGitHubPullRequestState(response.data.state),
  };
}

function toGitHubInstallationRepository(response: GitHubRepositoryApiResponse): GitHubInstallationRepository {
  const repositoryOwner: string = requireGitHubField(response.owner?.login, 'owner.login');
  const repositoryName: string = requireGitHubField(response.name, 'name');
  return {
    defaultBranchName: requireGitHubField(response.default_branch, 'default_branch'),
    fullName: `${repositoryOwner}/${repositoryName}`,
    private: response.private === true,
    repositoryExternalId: String(requireGitHubField(response.id, 'id')),
    repositoryName,
    repositoryOwner,
  };
}

function toGitHubRepositoryTreeEntry(entry: GitHubRepositoryTreeApiEntry): GitHubRepositoryTreeEntry[] {
  const type: string | undefined = entry.type;
  if (entry.path === undefined || (type !== 'blob' && type !== 'commit' && type !== 'tree')) {
    return [];
  }

  return [{ path: entry.path, type }];
}

function decodeGitHubRepositoryContent(
  path: string,
  response: GitHubRepositoryContentApiResponse | GitHubRepositoryContentApiResponse[],
): GitHubRepositoryContent {
  if (Array.isArray(response)) {
    throw new Error(`GitHub content ${path} is not a file.`);
  }
  if (response.encoding !== 'base64' || response.type !== 'file') {
    throw new Error(`GitHub content ${path} is not a base64 file.`);
  }

  return {
    content: Buffer.from(requireGitHubField(response.content, 'content').replace(/\s/gu, ''), 'base64').toString(
      'utf8',
    ),
    sha: requireGitHubField(response.sha, 'sha'),
  };
}
