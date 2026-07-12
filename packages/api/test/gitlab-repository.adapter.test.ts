import { describe, expect, it, vi } from 'vitest';
import { GitLabHttpClient } from '../src/services/git-source/gitlab-http.adapter';
import { listGitLabProjects } from '../src/services/git-source/gitlab-repository.adapter';

interface OutboundHttpModule {
  createGitLabTrustedOutboundFetch: () => typeof fetch;
}

vi.mock(
  '../src/services/outbound-http.service',
  (): OutboundHttpModule => ({ createGitLabTrustedOutboundFetch: (): typeof fetch => vi.fn<typeof fetch>() }),
);

describe('GitLab repository adapter', (): void => {
  it('omits empty projects without a default branch from repository listings', async (): Promise<void> => {
    const client: GitLabHttpClient = new GitLabHttpClient({ providerHost: 'gitlab.com', token: 'token' });
    vi.spyOn(client, 'requestPages').mockResolvedValueOnce([
      createProject({ default_branch: 'main', empty_repo: false, id: 1, path: 'ready' }),
      createProject({ default_branch: null, empty_repo: true, id: 2, path: 'empty' }),
    ]);

    await expect(listGitLabProjects(client)).resolves.toEqual([
      {
        defaultBranchName: 'main',
        fullName: 'group/ready',
        private: true,
        repositoryExternalId: '1',
        repositoryName: 'ready',
        repositoryOwner: 'group',
      },
    ]);
  });
});

interface GitLabProjectFixtureOverrides {
  default_branch: string | null;
  empty_repo: boolean;
  id: number;
  path: string;
}

interface GitLabProjectFixture extends GitLabProjectFixtureOverrides {
  http_url_to_repo: string;
  namespace: { full_path: string };
  path_with_namespace: string;
  visibility: string;
}

function createProject(overrides: GitLabProjectFixtureOverrides): GitLabProjectFixture {
  return {
    http_url_to_repo: `https://gitlab.com/group/${overrides.path}.git`,
    namespace: { full_path: 'group' },
    path_with_namespace: `group/${overrides.path}`,
    visibility: 'private',
    ...overrides,
  };
}
