import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitLabProviderRegistrationSummary } from '@compartment/contracts';
import {
  isGitLabRepositoryProvider,
  resolveGitLabRepositorySelection,
} from '../src/commands/sources/source-connect-gitlab.command';
import type { AuthenticatedContext } from '../src/services/context.types';
import { listGitLabRepositoriesForSource } from '../src/services/sources.service';

vi.mock('../src/services/sources.service');

const registration: GitLabProviderRegistrationSummary = {
  createdAt: '2026-07-11T00:00:00.000Z',
  providerHost: 'git.example.com',
  registrationId: 'gpr_1',
  tokenHolderLogin: 'alice',
};

interface ProviderDetectionCase {
  activeGitHubProviderHosts: string[];
  expected: boolean;
  host: string;
  registrations: GitLabProviderRegistrationSummary[];
  token: string | undefined;
}

describe('GitLab source provider detection', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });
  it.each([
    { activeGitHubProviderHosts: [], expected: true, host: 'gitlab.com', registrations: [], token: undefined },
    { activeGitHubProviderHosts: [], expected: false, host: 'github.com', registrations: [], token: 'stray' },
    {
      activeGitHubProviderHosts: ['ghe.example.com'],
      expected: false,
      host: 'ghe.example.com',
      registrations: [],
      token: 'stray',
    },
    { activeGitHubProviderHosts: [], expected: true, host: 'code.example.com', registrations: [], token: 'token' },
    {
      activeGitHubProviderHosts: [],
      expected: true,
      host: 'git.example.com',
      registrations: [registration],
      token: undefined,
    },
  ])('detects $host deterministically', (testCase: ProviderDetectionCase): void => {
    expect(
      isGitLabRepositoryProvider(
        testCase.host,
        testCase.token,
        testCase.registrations,
        testCase.activeGitHubProviderHosts,
      ),
    ).toBe(testCase.expected);
  });

  it('selects only an exact repository match', async (): Promise<void> => {
    vi.mocked(listGitLabRepositoriesForSource).mockResolvedValue({
      repositories: [
        { defaultBranchName: 'main', fullName: 'group/repo', id: '42', name: 'repo', owner: 'group', private: true },
      ],
    });
    await expect(
      resolveGitLabRepositorySelection(
        createContext(),
        {
          providerHost: 'git.example.com',
          repositoryName: 'repo',
          repositoryOwner: 'group',
        },
        undefined,
        [registration],
      ),
    ).resolves.toMatchObject({ registrationId: 'gpr_1', repository: { id: '42' } });
  });

  it('fails instead of selecting an unrelated repository', async (): Promise<void> => {
    vi.mocked(listGitLabRepositoriesForSource).mockResolvedValue({
      repositories: [
        { defaultBranchName: 'main', fullName: 'other/repo', id: '7', name: 'repo', owner: 'other', private: true },
      ],
    });
    await expect(
      resolveGitLabRepositorySelection(
        createContext(),
        {
          providerHost: 'git.example.com',
          repositoryName: 'repo',
          repositoryOwner: 'group',
        },
        undefined,
        [registration],
      ),
    ).rejects.toThrow('group/repo');
  });
});

function createContext(): AuthenticatedContext {
  return { apiUrl: 'https://example.com', remoteName: 'origin', sessionToken: 'token' };
}
