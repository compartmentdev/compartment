import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GitProviderRegistrationSummary } from '@compartment/contracts/browser';
import { GitLabConnect } from '../src/features/onboarding/onboarding-gitlab-connect';
import { readValidGitLabHost } from '../src/features/onboarding/onboarding-gitlab-host';
import { GitLabRegistrationChoices } from '../src/features/onboarding/onboarding-gitlab-registrations';
import { GitOnboardingPanel } from '../src/features/onboarding/onboarding-git-panel';
import type { OnboardingRouteState } from '../src/features/onboarding/onboarding-page.types';

vi.mock('../src/features/onboarding/onboarding-git-api', (): object => ({
  createBrowserGitLabProviderRegistration: vi.fn(),
  listBrowserGitProviderRegistrations: vi.fn().mockResolvedValue({ registrations: [] }),
}));

describe('browser onboarding GitLab connection', (): void => {
  it('renders the self-managed host and token form', (): void => {
    const markup: string = renderToStaticMarkup(
      createElement(GitLabConnect, {
        navigate: (): void => undefined,
        selectedOrganizationSlug: 'acme-dev',
      }),
    );

    expect(markup).toContain('Connect GitLab');
    expect(markup).toContain('GitLab host');
    expect(markup).toContain('value="gitlab.com"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('Create a personal access token');
    expect(markup).toContain(
      'href="https://gitlab.com/-/user_settings/personal_access_tokens?name=Compartment&amp;scopes=api"',
    );
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('with the api scope. Your account needs Maintainer access to the repository.');
  });

  it('does not trust a provider host from route state for the token link', (): void => {
    const routeState: OnboardingRouteState = {
      branchName: undefined,
      deployCompleted: false,
      descriptorPath: undefined,
      environmentName: undefined,
      gitAccountDiscoverySessionId: undefined,
      gitAccountDiscoveryToken: undefined,
      gitConnected: false,
      method: 'git',
      projectName: undefined,
      provider: 'gitlab',
      providerHost: 'evil.example',
      pullRequestNumber: undefined,
      pullRequestState: undefined,
      pullRequestStatusToken: undefined,
      registrationId: 'gpr_attacker',
      repositoryId: undefined,
      repositoryName: undefined,
      repositoryOwner: undefined,
      sessionId: undefined,
      sourceId: undefined,
      step: 'prepare',
      syncTaskId: undefined,
    };
    const markup: string = renderToStaticMarkup(
      createElement(GitOnboardingPanel, {
        consoleOrigin: 'https://console.example',
        navigate: (): void => undefined,
        routeState,
        selectedOrganizationSlug: 'acme-dev',
      }),
    );
    expect(markup).toContain('value="gitlab.com"');
    expect(markup).not.toContain('evil.example');
  });

  it('normalizes a pasted GitLab URL and rejects paths', (): void => {
    expect(readValidGitLabHost('https://GitLab.Corp.com/')).toBe('gitlab.corp.com');
    expect(readValidGitLabHost('https://gitlab.corp.com/group')).toBeNull();
  });

  it('renders non-expiring and malformed expiry values safely', (): void => {
    const base: GitProviderRegistrationSummary = {
      expiresAt: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      providerAccountLogin: 'alice',
      providerHost: 'gitlab.example.com',
      providerType: 'gitlab',
      registrationId: 'gpr_1',
    };
    const markup: string = renderToStaticMarkup(
      createElement(GitLabRegistrationChoices, {
        onSelect: (): void => undefined,
        registrations: [
          { ...base, expiresAt: null },
          { ...base, expiresAt: 'not-a-date', registrationId: 'gpr_2' },
        ],
      }),
    );
    expect(markup).toContain('does not expire');
    expect(markup).toContain('expiry date unavailable');
  });
});
