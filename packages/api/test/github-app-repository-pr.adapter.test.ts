import { Octokit } from '@octokit/rest';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type * as GitHubAppHttpAdapter from '../src/services/git-source/github-app-http.adapter';
import type { GitHubApiResponse } from '../src/services/git-source/github-app-http.adapter';
import { createGitHubRepositoryDescriptorPullRequest } from '../src/services/git-source/github-app-repository-pr.adapter';
import type { GitHubRepositoryPullRequest } from '../src/services/git-source/github-app-client.adapter.types';

interface GitHubGitRefApiResponse {
  object?: {
    sha?: string | undefined;
  };
}

interface CreateRefInput {
  owner: string;
  ref: string;
  repo: string;
  sha: string;
}

interface CreateOrUpdateFileContentsInput {
  branch: string;
  content: string;
  message: string;
  owner: string;
  path: string;
  repo: string;
}

interface PullRequestCreateInput {
  base: string;
  body: string;
  head: string;
  owner: string;
  repo: string;
  title: string;
}

interface GitHubRepositoryPullRequestApiResponse {
  html_url?: string;
  number?: number;
  state?: string;
}

type GetRef = () => Promise<GitHubApiResponse<GitHubGitRefApiResponse>>;
type CreateRef = (input: CreateRefInput) => Promise<void>;
type CreateOrUpdateFileContents = (input: CreateOrUpdateFileContentsInput) => Promise<void>;
type CreatePullRequest = (
  input: PullRequestCreateInput,
) => Promise<GitHubApiResponse<GitHubRepositoryPullRequestApiResponse>>;

const mocks: {
  createOrUpdateFileContents: Mock<CreateOrUpdateFileContents>;
  createPullRequest: Mock<CreatePullRequest>;
  createRef: Mock<CreateRef>;
  getRef: Mock<GetRef>;
} = vi.hoisted(
  (): {
    createOrUpdateFileContents: Mock<CreateOrUpdateFileContents>;
    createPullRequest: Mock<CreatePullRequest>;
    createRef: Mock<CreateRef>;
    getRef: Mock<GetRef>;
  } => ({
    createOrUpdateFileContents: vi.fn<CreateOrUpdateFileContents>(),
    createPullRequest: vi.fn<CreatePullRequest>(),
    createRef: vi.fn<CreateRef>(),
    getRef: vi.fn<GetRef>(),
  }),
);

vi.mock('../src/services/git-source/github-app-http.adapter', async (): Promise<typeof GitHubAppHttpAdapter> => {
  const actual: typeof GitHubAppHttpAdapter = await vi.importActual<typeof GitHubAppHttpAdapter>(
    '../src/services/git-source/github-app-http.adapter',
  );

  return {
    ...actual,
    createGitHubInstallationOctokit: vi.fn((): Octokit => {
      const octokit: Octokit = new Octokit();
      Object.assign(octokit.rest.git, {
        createRef: mocks.createRef,
        getRef: mocks.getRef,
      });
      Object.assign(octokit.rest.pulls, {
        create: mocks.createPullRequest,
      });
      Object.assign(octokit.rest.repos, {
        createOrUpdateFileContents: mocks.createOrUpdateFileContents,
      });
      return octokit;
    }),
  };
});

describe('GitHub App repository PR adapter', (): void => {
  it('writes descriptor draft files in path-sorted order before opening the pull request', async (): Promise<void> => {
    vi.resetAllMocks();
    mocks.getRef.mockResolvedValue({
      data: {
        object: {
          sha: 'abc123',
        },
      },
    });
    mocks.createPullRequest.mockResolvedValue({
      data: {
        html_url: 'https://github.enterprise.example/acme/mono/pull/17',
        number: 17,
        state: 'open',
      },
    });

    const pullRequest: GitHubRepositoryPullRequest = await createGitHubRepositoryDescriptorPullRequest({
      appId: '12345',
      baseBranchName: 'main',
      descriptorPath: 'compartment.yml',
      files: [
        {
          content: '<!doctype html>\n',
          path: 'apps/site/index.html',
        },
        {
          content: 'name: mono\n',
          path: 'compartment.yml',
        },
      ],
      installationId: '98765',
      owner: 'acme',
      privateKeyPem: 'private-key',
      projectName: 'mono',
      providerHost: 'github.enterprise.example',
      repositoryName: 'mono',
    });

    expect(pullRequest).toEqual({
      htmlUrl: 'https://github.enterprise.example/acme/mono/pull/17',
      number: 17,
      state: 'open',
    });
    expect(mocks.createRef).toHaveBeenCalledTimes(1);
    expect(mocks.createOrUpdateFileContents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: 'Add apps/site/index.html',
        path: 'apps/site/index.html',
      }),
    );
    expect(mocks.createOrUpdateFileContents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Add compartment.yml',
        path: 'compartment.yml',
      }),
    );
    expect(mocks.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Adds a starter Compartment app for mono.\n\n- `apps/site/index.html`\n- `compartment.yml`',
        title: 'Add Compartment starter app for mono',
      }),
    );
  });
});
