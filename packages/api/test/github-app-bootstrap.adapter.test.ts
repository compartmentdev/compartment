import { describe, expect, it, vi, type Mock } from 'vitest';
import { Octokit } from '@octokit/rest';
import type * as GitHubAppHttpAdapter from '../src/services/git-source/github-app-http.adapter';
import type { GitHubAppManifestPlan } from '../src/services/git-source/github-app-client.adapter.types';
import type { GitHubApiResponse } from '../src/services/git-source/github-app-http.adapter';
import { readGitHubAppManifestPlan } from '../src/services/git-source/github-app-bootstrap.adapter';

type GetByUsername = (input: { username: string }) => Promise<GitHubApiResponse<{ type: string }>>;

interface ParsedGitHubManifest {
  default_events: string[];
  default_permissions: Record<string, string>;
  name: string;
  public: boolean;
  setup_on_update: boolean;
}

const getByUsernameMock: Mock<GetByUsername> = vi.hoisted((): Mock<GetByUsername> => vi.fn<GetByUsername>());

vi.mock('../src/services/git-source/github-app-http.adapter', async (): Promise<typeof GitHubAppHttpAdapter> => {
  const actual: typeof GitHubAppHttpAdapter = await vi.importActual<typeof GitHubAppHttpAdapter>(
    '../src/services/git-source/github-app-http.adapter',
  );

  return {
    ...actual,
    createGitHubUnauthenticatedOctokit: vi.fn(
      (): Octokit =>
        Object.assign(new Octokit(), {
          rest: {
            users: {
              getByUsername: getByUsernameMock,
            },
          },
        }),
    ),
  };
});

describe('GitHub App bootstrap adapter', (): void => {
  it('builds a unique manifest app name from the selected owner', async (): Promise<void> => {
    getByUsernameMock.mockResolvedValueOnce({
      data: {
        type: 'User',
      },
    });

    const plan: GitHubAppManifestPlan = await readGitHubAppManifestPlan({
      callbackUrl: 'https://console.acme-wenc3z.app.compartment.run/v1/sources/git/providers/github/callback',
      controlPlaneUrl: 'https://console.acme-wenc3z.app.compartment.run',
      providerHost: 'github.com',
      repositoryOwner: 'octocat',
      setupUrl: 'https://console.acme-wenc3z.app.compartment.run/v1/sources/git/providers/github/setup',
      webhookUrl:
        'https://console.acme-wenc3z.app.compartment.run/v1/sources/git/providers/github/registrations/gpr_123/webhook',
    });

    const manifest: ParsedGitHubManifest = JSON.parse(plan.manifestJson) as ParsedGitHubManifest;

    expect(manifest.name).toBe('Compartment octocat');
    expect(manifest.name).toHaveLength(19);
    expect(manifest.default_permissions).toEqual({
      contents: 'write',
      metadata: 'read',
      pull_requests: 'write',
    });
    expect(manifest.default_events).toEqual(['push']);
    expect(manifest.public).toBe(false);
    expect(manifest.setup_on_update).toBe(false);
  });

  it('keeps generated manifest app names within GitHub length limits', async (): Promise<void> => {
    getByUsernameMock.mockResolvedValueOnce({
      data: {
        type: 'Organization',
      },
    });

    const plan: GitHubAppManifestPlan = await readGitHubAppManifestPlan({
      callbackUrl: 'https://console.enterprise.example/v1/sources/git/providers/github/callback',
      controlPlaneUrl: 'https://console.enterprise.example',
      providerHost: 'github.com',
      repositoryOwner: 'very-long-organization-name',
      setupUrl: 'https://console.enterprise.example/v1/sources/git/providers/github/setup',
      webhookUrl: 'https://console.enterprise.example/v1/sources/git/providers/github/registrations/gpr_123/webhook',
    });

    const manifest: ParsedGitHubManifest = JSON.parse(plan.manifestJson) as ParsedGitHubManifest;

    expect(manifest.name).toBe('Compartment very-long-organization');
    expect(manifest.name).toHaveLength(34);
  });
});
