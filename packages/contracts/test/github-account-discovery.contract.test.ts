import { describe, expect, it } from 'vitest';
import {
  gitHubAccountDiscoveryResultResponseSchema,
  gitHubAccountDiscoveryStartRequestSchema,
  type GitHubAccountDiscoveryAccount,
  type GitHubAccountDiscoveryResultResponse,
  type GitHubAccountDiscoveryStartRequest,
} from '../src';

describe('GitHub account discovery contract', (): void => {
  it('accepts a GitHub account discovery result', (): void => {
    const request: GitHubAccountDiscoveryStartRequest = gitHubAccountDiscoveryStartRequestSchema.parse({
      returnTo: 'https://console.example.com/sources/git/account-discovery',
    });
    const result: GitHubAccountDiscoveryResultResponse = gitHubAccountDiscoveryResultResponseSchema.parse({
      accounts: [
        {
          appInstallationStatus: 'installed',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1',
          login: 'octocat',
          type: 'user',
        },
        {
          appInstallationStatus: 'not_installed',
          avatarUrl: null,
          login: 'example-labs',
          type: 'organization',
        },
      ],
      user: {
        appInstallationStatus: 'installed',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1',
        login: 'octocat',
        type: 'user',
      },
    });

    expect(request.returnTo).toBe('https://console.example.com/sources/git/account-discovery');
    expect(result.accounts.map((account: GitHubAccountDiscoveryAccount): string => account.login)).toEqual([
      'octocat',
      'example-labs',
    ]);
  });
});
