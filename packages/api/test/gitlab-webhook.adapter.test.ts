import { describe, expect, it } from 'vitest';
import type { GitLabJsonObject } from '../src/services/git-source/gitlab-http.adapter.types';
import { parseGitLabPushPayload } from '../src/services/git-source/gitlab-webhook.adapter';
import type { ParsedGitLabPush } from '../src/services/git-source/gitlab-webhook.adapter.types';

describe('GitLab webhook adapter', (): void => {
  it('normalizes a complete push and preserves subgroup project identity', (): void => {
    const parsed: ParsedGitLabPush | null = parseGitLabPushPayload(buildPush({ total_commits_count: 1 }));
    expect(parsed).toEqual({
      branchName: 'main',
      changedFiles: ['added.txt', 'changed.txt', 'removed.txt'],
      changedFilesComplete: true,
      commitSha: 'abc123',
      repositoryExternalId: '42',
    });
  });

  it('marks truncated pushes incomplete and ignores branch deletion', (): void => {
    expect(parseGitLabPushPayload(buildPush({ total_commits_count: 2 }))?.changedFilesComplete).toBe(false);
    expect(parseGitLabPushPayload(buildPush({ checkout_sha: null }))).toBeNull();
  });
});

function buildPush(overrides: GitLabJsonObject): GitLabJsonObject {
  return {
    checkout_sha: 'abc123',
    commits: [{ added: ['added.txt'], modified: ['changed.txt'], removed: ['removed.txt'] }],
    object_kind: 'push',
    project: { id: 42, path_with_namespace: 'group/subgroup/repo' },
    ref: 'refs/heads/main',
    ...overrides,
  };
}
