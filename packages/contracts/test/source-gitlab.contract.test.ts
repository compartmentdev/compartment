import {
  createGitLabProviderRegistrationRequestSchema,
  gitLabProviderRegistrationListResponseSchema,
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
      gitLabProviderRegistrationListResponseSchema.parse({
        activeGitHubProviderHosts: ['github.example.com'],
        registrations: [
          {
            createdAt: '2026-01-01T00:00:00Z',
            providerHost: 'gitlab.com',
            registrationId: 'gpr_1',
            tokenHolderLogin: 'alice',
          },
        ],
      }).registrations,
    ).toHaveLength(1);
  });

  it('keeps legacy worker claims compatible without provider fields', (): void => {
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
    installationToken: 'token',
    projectName: 'app',
    providerHost: 'github.com',
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
    installationToken: 'token',
    providerHost: 'github.com',
    repositoryName: 'repo',
    repositoryOwner: 'owner',
    requestedBranchName: 'main',
    sourceId: 'src_1',
    taskId: 'task_1',
    triggerCommitSha: null,
  };
}
