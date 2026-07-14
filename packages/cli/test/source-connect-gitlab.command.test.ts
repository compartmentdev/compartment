import type { GitProviderRegistrationSummary } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveGitSourceProvider } from '../src/commands/sources/source-connect-git-providers';
import { resolveGitLabRepositorySelection } from '../src/commands/sources/source-connect-gitlab.command';
import type { AuthenticatedContext } from '../src/services/context.types';
import { listGitProviderRepositoriesForSource } from '../src/services/sources.service';

vi.mock('../src/services/sources.service');
const originalGitLabToken: string | undefined = process.env.COMPARTMENT_GITLAB_TOKEN;

afterEach((): void => {
  if (originalGitLabToken === undefined) delete process.env.COMPARTMENT_GITLAB_TOKEN;
  else process.env.COMPARTMENT_GITLAB_TOKEN = originalGitLabToken;
});

const gitLabRegistration: GitProviderRegistrationSummary = {
  createdAt: '2026-07-11T00:00:00.000Z',
  expiresAt: '2026-08-11T00:00:00.000Z',
  providerAccountLogin: 'alice',
  providerHost: 'git.example.com',
  providerType: 'gitlab',
  registrationId: 'gpr_1',
};

describe('Git source provider resolution', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('honors explicit provider before registrations and well-known hosts', (): void => {
    expect(resolveGitSourceProvider('github.com', 'gitlab', []).providerType).toBe('gitlab');
  });

  it('uses a neutral registration before well-known host fallback', (): void => {
    expect(resolveGitSourceProvider('git.example.com', undefined, [gitLabRegistration]).providerType).toBe('gitlab');
    expect(resolveGitSourceProvider('github.com', undefined, []).providerType).toBe('github_app');
    expect(resolveGitSourceProvider('gitlab.com', undefined, []).providerType).toBe('gitlab');
  });

  it('fails safely for an unknown host even when a GitLab token exists', (): void => {
    process.env.COMPARTMENT_GITLAB_TOKEN = 'must-not-leak';
    expect((): void => {
      resolveGitSourceProvider('ghe.example.com', undefined, []);
    }).toThrow('Unknown host ghe.example.com: pass --provider or register the provider first.');
  });

  it('rejects an invalid explicit provider', (): void => {
    expect((): void => {
      resolveGitSourceProvider('gitlab.com', 'gitlba', []);
    }).toThrow('Unknown provider gitlba: pass --provider github or --provider gitlab.');
  });

  it('rejects two provider types registered on the same host', (): void => {
    expect((): void => {
      resolveGitSourceProvider('git.example.com', undefined, [
        gitLabRegistration,
        { ...gitLabRegistration, providerType: 'github_app', registrationId: 'gpr_github' },
      ]);
    }).toThrow('Host git.example.com has multiple provider types: pass --provider.');
  });
});

describe('GitLab registration lookup', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('continues after one registration fails and uses a later match', async (): Promise<void> => {
    vi.mocked(listGitProviderRepositoriesForSource)
      .mockRejectedValueOnce(new Error('revoked token'))
      .mockResolvedValueOnce({
        repositories: [
          { defaultBranchName: 'main', fullName: 'group/repo', id: '42', name: 'repo', owner: 'group', private: true },
        ],
      });
    await expect(
      resolveGitLabRepositorySelection(createContext(), createPlan(), undefined, [
        gitLabRegistration,
        { ...gitLabRegistration, registrationId: 'gpr_2' },
      ]),
    ).resolves.toMatchObject({ registrationId: 'gpr_2', repository: { id: '42' } });
  });

  it('reports every failed registration outcome', async (): Promise<void> => {
    vi.mocked(listGitProviderRepositoriesForSource)
      .mockRejectedValueOnce(new Error('revoked token'))
      .mockResolvedValueOnce({ repositories: [] });
    await expect(
      resolveGitLabRepositorySelection(createContext(), createPlan(), undefined, [
        gitLabRegistration,
        { ...gitLabRegistration, registrationId: 'gpr_2' },
      ]),
    ).rejects.toThrow('gpr_1: revoked token; gpr_2: Repository group/repo is not available to this registration');
  });
});

function createContext(): AuthenticatedContext {
  return { apiUrl: 'https://example.com', remoteName: 'origin', sessionToken: 'token' };
}

function createPlan(): { providerHost: string; repositoryName: string; repositoryOwner: string } {
  return { providerHost: 'git.example.com', repositoryName: 'repo', repositoryOwner: 'group' };
}
