import { describe, expect, it, vi } from 'vitest';
import { GitLabHttpClient } from '../src/services/git-source/gitlab-http.adapter';
import { readGitLabMergeRequestStatus } from '../src/services/git-source/gitlab-merge-request.adapter';

describe('GitLab merge request adapter', (): void => {
  it.each([
    ['opened', 'open', false],
    ['merged', 'closed', true],
    ['closed', 'closed', false],
    ['locked', 'closed', false],
  ] as const)(
    'maps %s state',
    async (providerState: string, state: 'closed' | 'open', merged: boolean): Promise<void> => {
      const client: GitLabHttpClient = Object.create(GitLabHttpClient.prototype) as GitLabHttpClient;
      vi.spyOn(client, 'request').mockResolvedValue({
        iid: 7,
        state: providerState,
        web_url: 'https://gitlab.com/mr/7',
      });
      await expect(readGitLabMergeRequestStatus(client, '42', 7)).resolves.toEqual({
        htmlUrl: 'https://gitlab.com/mr/7',
        merged,
        state,
      });
    },
  );
});
