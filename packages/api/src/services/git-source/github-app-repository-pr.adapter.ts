import type { Octokit } from '@octokit/rest';
import type { GitDescriptorDraftFile } from '@compartment/contracts';
import type {
  CreateGitHubRepositoryDescriptorPullRequestInput,
  GitHubRepositoryPullRequest,
} from './github-app-client.adapter.types';
import { type GitHubApiResponse, createGitHubInstallationOctokit, requireGitHubField } from './github-app-http.adapter';
import { readGitHubPullRequestState } from './github-app-pull-request-state.adapter';
import { sortGitDescriptorDraftFiles } from './git-source-descriptor-draft-file.support';

interface GitHubGitRefApiResponse {
  object?: {
    sha?: string | undefined;
  };
}

interface GitHubRepositoryPullRequestApiResponse {
  html_url?: string;
  number?: number;
  state?: string;
}

interface GitHubPullRequestCreateInput {
  base: string;
  body: string;
  head: string;
  title: string;
}

export async function createGitHubRepositoryDescriptorPullRequest(
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
): Promise<GitHubRepositoryPullRequest> {
  const octokit: Octokit = createGitHubInstallationOctokit(input);
  const baseSha: string = await readGitHubBranchHeadSha(input, octokit);
  const headBranchName: string = `compartment/add-descriptor-${Date.now().toString(36)}`;
  await createGitHubBranch(input, octokit, headBranchName, baseSha);
  try {
    await putGitHubRepositoryFiles(input, octokit, headBranchName);
    return await createGitHubPullRequest(input, octokit, headBranchName);
  } catch (error) {
    const failure: Error = error instanceof Error ? error : new Error('Unknown GitHub pull request failure.');
    await removeFailedGitHubPullRequestBranch(input, octokit, headBranchName, failure);
    throw error;
  }
}

async function removeFailedGitHubPullRequestBranch(
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
  octokit: Octokit,
  headBranchName: string,
  failure: Error,
): Promise<void> {
  try {
    await octokit.rest.git.deleteRef({
      owner: input.owner,
      ref: `heads/${headBranchName}`,
      repo: input.repositoryName,
    });
  } catch (cleanupError) {
    throw new AggregateError(
      [failure, cleanupError],
      'GitHub pull request failed and its branch could not be removed.',
    );
  }
}

async function readGitHubBranchHeadSha(
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
  octokit: Octokit,
): Promise<string> {
  const response: GitHubApiResponse<GitHubGitRefApiResponse> = await octokit.rest.git.getRef({
    owner: input.owner,
    ref: `heads/${input.baseBranchName}`,
    repo: input.repositoryName,
  });

  return requireGitHubField(response.data.object?.sha, 'object.sha');
}

async function createGitHubBranch(
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
  octokit: Octokit,
  headBranchName: string,
  baseSha: string,
): Promise<void> {
  await octokit.rest.git.createRef({
    owner: input.owner,
    ref: `refs/heads/${headBranchName}`,
    repo: input.repositoryName,
    sha: baseSha,
  });
}

async function putGitHubRepositoryFiles(
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
  octokit: Octokit,
  headBranchName: string,
): Promise<void> {
  for (const file of sortGitDescriptorDraftFiles(input.files)) {
    await putGitHubRepositoryFile(file, input, octokit, headBranchName);
  }
}

async function putGitHubRepositoryFile(
  file: GitDescriptorDraftFile,
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
  octokit: Octokit,
  headBranchName: string,
): Promise<void> {
  await octokit.rest.repos.createOrUpdateFileContents({
    branch: headBranchName,
    content: Buffer.from(file.content, 'utf8').toString('base64'),
    message: `Add ${file.path}`,
    owner: input.owner,
    path: file.path,
    repo: input.repositoryName,
  });
}

async function createGitHubPullRequest(
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
  octokit: Octokit,
  headBranchName: string,
): Promise<GitHubRepositoryPullRequest> {
  const response: GitHubApiResponse<GitHubRepositoryPullRequestApiResponse> = await octokit.rest.pulls.create({
    ...readPullRequestBody(input, headBranchName),
    owner: input.owner,
    repo: input.repositoryName,
  });

  return toGitHubRepositoryPullRequest(response.data);
}

function toGitHubRepositoryPullRequest(response: GitHubRepositoryPullRequestApiResponse): GitHubRepositoryPullRequest {
  return {
    htmlUrl: requireGitHubField(response.html_url, 'html_url'),
    number: Number(requireGitHubField(response.number, 'number')),
    state: readGitHubPullRequestState(response.state),
  };
}

function readPullRequestBody(
  input: CreateGitHubRepositoryDescriptorPullRequestInput,
  headBranchName: string,
): GitHubPullRequestCreateInput {
  const isStarterPullRequest: boolean = input.files.some(
    (file: GitDescriptorDraftFile): boolean => file.path !== input.descriptorPath,
  );
  const addedFiles: string = sortGitDescriptorDraftFiles(input.files)
    .map((file: GitDescriptorDraftFile): string => `- \`${file.path}\``)
    .join('\n');
  return {
    base: input.baseBranchName,
    body: isStarterPullRequest
      ? `Adds a starter Compartment app for ${input.projectName}.\n\n${addedFiles}`
      : `Adds ${input.descriptorPath} so Compartment can deploy ${input.projectName}.`,
    head: headBranchName,
    title: isStarterPullRequest
      ? `Add Compartment starter app for ${input.projectName}`
      : `Add Compartment descriptor for ${input.projectName}`,
  };
}
