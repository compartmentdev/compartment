import {
  createGitLabProviderRegistrationRequestSchema,
  gitProviderRegistrationListResponseSchema,
  workerClaimGitSourceResolutionTaskResponseSchema,
  workerClaimGitSourceSyncTaskResponseSchema,
} from '../src/index';
import { describe, expect, it } from 'vitest';

describe('GitLab source contracts', (): void => {
  it('parses registration requests and summaries', (): void => {
    expect(
      createGitLabProviderRegistrationRequestSchema.parse({ accessToken: 'token', providerHost: 'gitlab.com' }),
    ).toEqual({ accessToken: 'token', providerHost: 'gitlab.com' });
    expect(
      gitProviderRegistrationListResponseSchema.parse({
        registrations: [
          {
            createdAt: '2026-01-01T00:00:00Z',
            expiresAt: '2026-12-31T23:59:59.999Z',
            providerAccountLogin: 'alice',
            providerHost: 'gitlab.com',
            providerType: 'gitlab',
            registrationId: 'gpr_1',
          },
        ],
      }).registrations,
    ).toHaveLength(1);
  });

  it('requires provider fields on worker claims', (): void => {
    expect((): void => {
      workerClaimGitSourceResolutionTaskResponseSchema.parse({ task: buildResolutionClaim() });
    }).not.toThrow();
    expect((): void => {
      workerClaimGitSourceSyncTaskResponseSchema.parse({ task: buildSyncClaim() });
    }).not.toThrow();
  });
});

function buildResolutionClaim(): Record<string, string> {
  return {
    branchName: 'main',
    commitSha: 'abc',
    descriptorPath: 'compartment.yml',
    providerAccessToken: 'token',
    projectName: 'app',
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryExternalId: 'repo_1',
    repositoryName: 'repo',
    repositoryOwner: 'owner',
    sourceBindingId: 'sbd_1',
    sourceEventId: 'sev_1',
    sourceId: 'src_1',
    targetEnvironmentName: 'production',
    taskId: 'task_1',
  };
}

function buildSyncClaim(): Record<string, string | null> {
  return {
    claimToken: 'claim',
    providerAccessToken: 'token',
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryExternalId: 'repo_1',
    repositoryName: 'repo',
    repositoryOwner: 'owner',
    requestedBranchName: 'main',
    sourceId: 'src_1',
    taskId: 'task_1',
    triggerCommitSha: null,
  };
}
