import { Octokit } from '@octokit/rest';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type * as GitHubAppHttpAdapter from '../src/services/git-source/github-app-http.adapter';
import type { GitHubApiResponse } from '../src/services/git-source/github-app-http.adapter';
import {
  listGitHubInstallationRepositories,
  readGitHubRepositoryTree,
} from '../src/services/git-source/github-app-repository.adapter';

interface GitHubRepositoryApiResponse {
  default_branch: string;
  id: number;
  name: string;
  owner: {
    login: string;
  };
  private: boolean;
}

interface GitHubInstallationRepositoriesApiResponse {
  repositories: GitHubRepositoryApiResponse[];
}

interface GitHubPaginatedApiResponse<TData> extends GitHubApiResponse<TData> {
  headers: {
    link?: string | undefined;
  };
}

interface GitHubRepositoryTreeApiResponse {
  tree: [];
  truncated?: boolean | undefined;
}

interface ListReposAccessibleToInstallationInput {
  page: number;
  per_page: number;
}

type ListReposAccessibleToInstallation = (
  input: ListReposAccessibleToInstallationInput,
) => Promise<GitHubPaginatedApiResponse<GitHubInstallationRepositoriesApiResponse>>;

type GetTree = () => Promise<GitHubApiResponse<GitHubRepositoryTreeApiResponse>>;

const mocks: {
  getTree: Mock<GetTree>;
  listReposAccessibleToInstallation: Mock<ListReposAccessibleToInstallation>;
} = vi.hoisted(
  (): {
    getTree: Mock<GetTree>;
    listReposAccessibleToInstallation: Mock<ListReposAccessibleToInstallation>;
  } => ({
    getTree: vi.fn<GetTree>(),
    listReposAccessibleToInstallation: vi.fn<ListReposAccessibleToInstallation>(),
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
      Object.assign(octokit.rest.apps, {
        listReposAccessibleToInstallation: mocks.listReposAccessibleToInstallation,
      });
      Object.assign(octokit.rest.git, {
        getTree: mocks.getTree,
      });
      return octokit;
    }),
  };
});

describe('GitHub App repository adapter', (): void => {
  it('lists installation repositories from wrapped GitHub installation responses', async (): Promise<void> => {
    mocks.listReposAccessibleToInstallation
      .mockResolvedValueOnce({
        data: {
          repositories: [
            {
              default_branch: 'main',
              id: 12345,
              name: 'mono',
              owner: {
                login: 'acme',
              },
              private: true,
            },
          ],
        },
        headers: {
          link: '<https://api.github.enterprise.example/installation/repositories?page=2>; rel="next"',
        },
      })
      .mockResolvedValueOnce({
        data: {
          repositories: [
            {
              default_branch: 'develop',
              id: 67890,
              name: 'worker',
              owner: {
                login: 'acme',
              },
              private: false,
            },
          ],
        },
        headers: {},
      });

    await expect(
      listGitHubInstallationRepositories({
        appId: '12345',
        installationId: '98765',
        privateKeyPem: 'private-key',
        providerHost: 'github.enterprise.example',
      }),
    ).resolves.toEqual([
      {
        defaultBranchName: 'main',
        fullName: 'acme/mono',
        private: true,
        repositoryExternalId: '12345',
        repositoryName: 'mono',
        repositoryOwner: 'acme',
      },
      {
        defaultBranchName: 'develop',
        fullName: 'acme/worker',
        private: false,
        repositoryExternalId: '67890',
        repositoryName: 'worker',
        repositoryOwner: 'acme',
      },
    ]);

    expect(mocks.listReposAccessibleToInstallation).toHaveBeenNthCalledWith(1, { page: 1, per_page: 100 });
    expect(mocks.listReposAccessibleToInstallation).toHaveBeenNthCalledWith(2, { page: 2, per_page: 100 });
  });

  it('rejects truncated repository trees instead of returning partial descriptor candidates', async (): Promise<void> => {
    mocks.getTree.mockResolvedValue({
      data: {
        tree: [],
        truncated: true,
      },
    });

    await expect(
      readGitHubRepositoryTree({
        appId: '12345',
        branchName: 'main',
        installationId: '98765',
        owner: 'acme',
        privateKeyPem: 'private-key',
        providerHost: 'github.enterprise.example',
        repositoryName: 'mono',
      }),
    ).rejects.toThrow('GitHub repository tree for acme/mono@main is truncated.');
  });
});
