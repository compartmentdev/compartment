import { z } from 'zod';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { GitLabHttpClient } from '../src/services/git-source/gitlab-http.adapter';
import type { GitLabJsonValue, GitLabRequestInput } from '../src/services/git-source/gitlab-http.adapter.types';
import {
  createGitLabDescriptorMergeRequest,
  readGitLabMergeRequestStatus,
} from '../src/services/git-source/gitlab-merge-request.adapter';
import type { CreateDescriptorPullRequestPlan } from '../src/services/git-source/git-source-provider.types';

const branchRequestBodySchema: z.ZodType<{ branch: string }> = z.object({ branch: z.string() }).passthrough();
type GitLabRequest = <T>(input: GitLabRequestInput) => Promise<T>;

describe('GitLab merge request adapter', (): void => {
  it('uses a distinct branch consistently for each merge request', async (): Promise<void> => {
    const client: GitLabHttpClient = Object.create(GitLabHttpClient.prototype) as GitLabHttpClient;
    const request: MockInstance<GitLabRequest> = vi.spyOn(client, 'request');
    for (const iid of [7, 8]) {
      request
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ iid, state: 'opened', web_url: `https://gitlab.com/mr/${iid.toString()}` });
    }
    const plan: CreateDescriptorPullRequestPlan = {
      baseBranchName: 'main',
      descriptorPath: 'compartment.yml',
      files: [{ content: 'name: web', path: 'compartment.yml' }],
      projectName: 'web',
    };

    await createGitLabDescriptorMergeRequest(client, '42', plan);
    await createGitLabDescriptorMergeRequest(client, '42', plan);

    const firstBranch: string = readRequestBranch(request.mock.calls[0]?.[0].body);
    const secondBranch: string = readRequestBranch(request.mock.calls[3]?.[0].body);
    expect(firstBranch).not.toBe(secondBranch);
    expect(request.mock.calls[1]?.[0].body).toMatchObject({ branch: firstBranch });
    expect(request.mock.calls[2]?.[0].body).toMatchObject({ source_branch: firstBranch });
    expect(request.mock.calls[4]?.[0].body).toMatchObject({ branch: secondBranch });
    expect(request.mock.calls[5]?.[0].body).toMatchObject({ source_branch: secondBranch });
  });

  it('deletes the created branch when merge request creation fails', async (): Promise<void> => {
    const client: GitLabHttpClient = Object.create(GitLabHttpClient.prototype) as GitLabHttpClient;
    const request: MockInstance<GitLabRequest> = vi.spyOn(client, 'request');
    request
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('merge request failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      createGitLabDescriptorMergeRequest(client, '42', {
        baseBranchName: 'main',
        descriptorPath: 'compartment.yml',
        files: [{ content: 'name: web', path: 'compartment.yml' }],
        projectName: 'web',
      }),
    ).rejects.toThrow('merge request failed');
    const branch: string = readRequestBranch(request.mock.calls[0]?.[0].body);
    expect(request).toHaveBeenLastCalledWith({
      method: 'DELETE',
      path: `/projects/42/repository/branches/${encodeURIComponent(branch)}`,
    });
  });

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

function readRequestBranch(body: GitLabJsonValue | undefined): string {
  return branchRequestBodySchema.parse(body).branch;
}
