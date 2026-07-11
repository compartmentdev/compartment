import { describe, expect, it, vi } from 'vitest';
import type { GitLabJsonObject } from '../src/services/git-source/gitlab-http.adapter.types';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import { parseGitLabPushPayload, verifyGitLabWebhookToken } from '../src/services/git-source/gitlab-webhook.adapter';
import type { ParsedGitLabPush } from '../src/services/git-source/gitlab-webhook.adapter.types';

vi.mock(
  '../src/services/git-source/git-source-runtime.support',
  async (importOriginal: () => Promise<object>): Promise<object> => {
    const original: object = await importOriginal();
    return { ...original, readGitProviderWebhookSecret: (): string => 'secret' };
  },
);

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

  it('verifies tokens without accepting mismatches or different lengths', (): void => {
    const registration: GitProviderRegistrationRow = {
      webhookSecretCiphertext: 'secret',
    } as GitProviderRegistrationRow;
    expect((): void => verifyGitLabWebhookToken(registration, 'secret')).not.toThrow();
    expect((): void => verifyGitLabWebhookToken(registration, 'wrong!')).toThrow(/invalid/u);
    expect((): void => verifyGitLabWebhookToken(registration, 'short')).toThrow(/invalid/u);
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
